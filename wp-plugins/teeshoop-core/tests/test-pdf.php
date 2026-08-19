<?php
/**
 * The PDF writer.
 *
 * A hand-rolled file format is exactly the place to check the parts a reader
 * will reject rather than the parts that look right in a hex dump: the cross
 * reference table has to point at the objects, and every character of French an
 * invoice carries has to survive the trip into Windows-1252.
 *
 * The independent read is not here. `scripts/invoice-verify.mjs` opens a real
 * invoice with poppler, which shares no code with this file; these cases are
 * about the writer's own contract.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

/*
 * COMMAND LINE ONLY. `wp-content/plugins/` is served by URL and this directory
 * is inside it: before the guards, GET on any of these files ran the suite to
 * the public internet and printed the figures of every failing assertion.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Pdf.php';

use Teeshoop\Core\Pdf;

describe( 'Pdf: the file a reader has to accept', function () {
	it( 'declares a version, ends with the marker, and points at its own objects', function () {
		$pdf = new Pdf();
		$pdf->text( 20, 30, 'Facture FA2026-0001', Pdf::BOLD, 16 );
		$out = $pdf->render( 'Facture', "D:20260818000000+00'00'" );

		truthy( str_starts_with( $out, '%PDF-1.' ), 'no header' );
		truthy( str_ends_with( rtrim( $out ), '%%EOF' ), 'no trailer marker' );

		/*
		 * THE CROSS REFERENCE TABLE IS THE PART THAT SILENTLY BREAKS. Every
		 * offset it lists must land on that object's own "N 0 obj". A writer
		 * that emits plausible bytes with a wrong table produces a file poppler
		 * repairs, Acrobat refuses and nobody notices until a customer does.
		 */
		$at = strpos( $out, "\nxref\n" );
		truthy( false !== $at, 'no xref table' );
		$table = substr( $out, $at + 6 );
		$lines = explode( "\n", $table );
		$count = (int) explode( ' ', $lines[0] )[1];
		truthy( $count > 5, 'the file declares almost no objects' );

		for ( $id = 1; $id < $count; $id++ ) {
			$entry = $lines[ $id + 1 ];
			if ( str_contains( $entry, ' f ' ) ) {
				continue;
			}
			$offset = (int) substr( $entry, 0, 10 );
			eq( substr( $out, $offset, strlen( "{$id} 0 obj" ) ), "{$id} 0 obj", "object {$id} is not where the table says" );
		}
	} );

	it( 'starts a new page when asked and counts them', function () {
		$pdf = new Pdf();
		$pdf->text( 20, 20, 'un' );
		$pdf->page_break();
		$pdf->text( 20, 20, 'deux' );
		$out = $pdf->render( 'Deux pages', "D:20260818000000+00'00'" );
		truthy( str_contains( $out, '/Count 2' ), 'the page tree does not carry two pages' );
	} );

	it( 'writes one page even when nothing was drawn on it', function () {
		$out = ( new Pdf() )->render( 'Vide', "D:20260818000000+00'00'" );
		truthy( str_contains( $out, '/Count 1' ) );
	} );
} );

describe( 'Pdf: French survives the encoding', function () {
	it( 'loses nothing an invoice actually contains', function () {
		$pdf = new Pdf();
		$pdf->text(
			20,
			20,
			'Créations personnalisées à l’unité : 1 234,56 EUR, œuvre, « devis », TVA non applicable, article 293 B du CGI'
		);
		$pdf->render( 'Accents', "D:20260818000000+00'00'" );
		eq( $pdf->lost(), 0, 'a character of the invoice could not be written' );
	} );

	it( 'counts what it cannot write instead of dropping it silently', function () {
		$pdf = new Pdf();
		// Nothing an invoice needs, and exactly the case that must be loud: a
		// customer's company name in an alphabet Windows-1252 has no room for.
		$pdf->text( 20, 20, 'Ώμέγα' );
		$pdf->render( 'Grec', "D:20260818000000+00'00'" );
		truthy( $pdf->lost() > 0, 'unwritable characters were dropped in silence' );
	} );

	it( 'escapes the three characters that would end a string early', function () {
		$pdf = new Pdf();
		$pdf->text( 20, 20, 'Société (Test) \\ fin' );
		$out = $pdf->render( 'Parenthèses', "D:20260818000000+00'00'" );
		// The stream is deflated, so inflate it and look at the operators.
		$at     = strpos( $out, "stream\n" );
		$stream = substr( $out, $at + 7 );
		$body   = @gzuncompress( $stream );
		truthy( false !== $body, 'the content stream is not readable deflate' );
		truthy( str_contains( $body, '\\(Test\\)' ), 'a parenthesis was not escaped' );
		truthy( str_contains( $body, '\\\\' ), 'a backslash was not escaped' );
	} );
} );

describe( 'Pdf: the metrics that align a column of prices', function () {
	it( 'gives every digit the same width, which is what makes a total line up', function () {
		$widths = array();
		foreach ( str_split( '0123456789' ) as $digit ) {
			$widths[] = Pdf::width_mm( $digit, Pdf::REGULAR, 10 );
		}
		eq( count( array_unique( $widths ) ), 1, 'the digits are not tabular' );
		eq( count( array_unique( array_map( static fn( $d ) => Pdf::width_mm( $d, Pdf::BOLD, 10 ), str_split( '0123456789' ) ) ) ), 1 );
	} );

	it( 'measures a wide string as wider than a narrow one', function () {
		truthy( Pdf::width_mm( 'MMMM', Pdf::REGULAR, 10 ) > Pdf::width_mm( 'iiii', Pdf::REGULAR, 10 ) );
		truthy( Pdf::width_mm( 'Total', Pdf::BOLD, 10 ) > Pdf::width_mm( 'Total', Pdf::REGULAR, 10 ) );
	} );

	it( 'scales with the point size and starts at zero', function () {
		eq( Pdf::width_mm( '', Pdf::REGULAR, 10 ), 0.0 );
		near( Pdf::width_mm( '1234', Pdf::REGULAR, 20 ), 2 * Pdf::width_mm( '1234', Pdf::REGULAR, 10 ), 1e-9 );
	} );

	it( 'gives an accented letter its base letter’s advance', function () {
		// Helvetica composes them, so "é" advances exactly like "e". A table
		// that guessed here would drift a right-aligned total by a millimetre
		// per accent.
		eq( Pdf::width_mm( 'é', Pdf::REGULAR, 10 ), Pdf::width_mm( 'e', Pdf::REGULAR, 10 ) );
		eq( Pdf::width_mm( 'À', Pdf::BOLD, 10 ), Pdf::width_mm( 'A', Pdf::BOLD, 10 ) );
	} );

	it( 'truncates to a width and says so with an ellipsis', function () {
		$long = 'Tee-shirt personnalisé, impression devant et dos, coton biologique';
		$fit  = Pdf::fit( $long, 40, Pdf::REGULAR, 9.5 );

		truthy( Pdf::width_mm( $fit, Pdf::REGULAR, 9.5 ) <= 40.0, 'the truncation still overflows' );
		truthy( str_ends_with( $fit, "\u{2026}" ), 'a cut string does not say it was cut' );
		eq( Pdf::fit( 'court', 40, Pdf::REGULAR, 9.5 ), 'court', 'a string that fits was cut anyway' );
	} );
} );

/**
 * A real 6 x 4 baseline JPEG, three components, written by libjpeg through GD.
 *
 * BYTES AND NOT A GENERATOR, because the machine this suite runs on has no GD
 * at all (the WordPress container has, and so does o2switch). A parser tested
 * against a fixture some other code in this repository produced would be a
 * parser tested against itself. This one came out of libjpeg, and what it
 * contains was read back by two things that share no code with `Pdf`: poppler
 * (`pdfimages -list`: 6 x 4, rgb, 3 comp, 8 bpc, jpeg) and a Python marker
 * walker (SOF0, precision 8, 6 x 4, three components).
 */
function ts_pdf_jpeg_rgb(): string {
	return base64_decode(
		'/9j/4AAQSkZJRgABAQEAYABgAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2NjIpLCBx'
		. 'dWFsaXR5ID0gNzAK/9sAQwAKBwcIBwYKCAgICwoKCw4YEA4NDQ4dFRYRGCMfJSQiHyIhJis3LyYpNCkhIjBBMTQ5Oz4+'
		. 'PiUuRElDPEg3PT47/9sAQwEKCwsODQ4cEBAcOygiKDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7'
		. 'Ozs7Ozs7Ozs7Ozs7/8AAEQgABAAGAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQ'
		. 'AAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2'
		. 'Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4'
		. 'ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYH'
		. 'CAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEX'
		. 'GBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWm'
		. 'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8AzaKKK8E/'
		. 'Qj//2Q=='
	);
}

/** The same image written progressive (SOF2), which this writer must refuse. */
function ts_pdf_jpeg_progressive(): string {
	return base64_decode(
		'/9j/4AAQSkZJRgABAQEAYABgAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2NjIpLCBx'
		. 'dWFsaXR5ID0gNzAK/9sAQwAKBwcIBwYKCAgICwoKCw4YEA4NDQ4dFRYRGCMfJSQiHyIhJis3LyYpNCkhIjBBMTQ5Oz4+'
		. 'PiUuRElDPEg3PT47/9sAQwEKCwsODQ4cEBAcOygiKDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7'
		. 'Ozs7Ozs7Ozs7Ozs7/8IAEQgABAAGAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAE/8QAFQEBAQAAAAAAAAAA'
		. 'AAAAAAAABAb/2gAMAwEAAhADEAAAAZgCh//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAA'
		. 'AAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAA'
		. 'AAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//aAAwDAQACAAMAAAAQA//E'
		. 'ABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Qf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Qf//EABQQ'
		. 'AQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Qf//Z'
	);
}

/**
 * The first page's decompressed content stream.
 *
 * NAMED BY ITS FILTER, not by being the first `stream` in the file. An image
 * object is emitted before any page, and looking for the first one handed a
 * JPEG to gzuncompress: the case that catches a stretched image failed with a
 * zlib warning instead of with its own assertion.
 */
function ts_pdf_page_ops( string $pdf ): string {
	$needle = "/Filter /FlateDecode >>\nstream\n";
	$at     = strpos( $pdf, $needle );
	if ( false === $at ) {
		fail( 'no content stream in the document' );
	}
	$from = $at + strlen( $needle );
	$end  = strpos( $pdf, "\nendstream", $from );
	return (string) gzuncompress( substr( $pdf, $from, $end - $from ) );
}

describe( 'Pdf: the one raster it embeds', function () {
	it( 'reads a real baseline JPEG the way two independent parsers do', function () {
		$size = Pdf::jpeg_size( ts_pdf_jpeg_rgb() );
		eq( $size['w'], 6, 'largeur' );
		eq( $size['h'], 4, 'hauteur' );
		eq( $size['gray'], false, 'trois composantes, donc RVB' );
	} );

	it( 'refuses a progressive JPEG rather than embedding one nobody can decode', function () {
		/*
		 * DCTDecode copies the bytes in unexamined, so a reader that cannot
		 * decode progressive shows NOTHING: a blank space on the one document
		 * whose whole job is showing the customer their artwork. Refusing means
		 * the caller prints a sentence saying so, which is a proof nobody
		 * approves by accident.
		 */
		eq( Pdf::jpeg_size( ts_pdf_jpeg_progressive() ), null, 'progressif accepté' );
	} );

	it( 'refuses anything that is not a JPEG, and a JPEG cut short', function () {
		eq( Pdf::jpeg_size( 'hello world' ), null, 'du texte' );
		eq( Pdf::jpeg_size( '' ), null, 'rien du tout' );
		eq( Pdf::jpeg_size( substr( ts_pdf_jpeg_rgb(), 0, 12 ) ), null, 'un fichier tronqué' );
		// A PNG signature: the format the design preview is actually stored in,
		// which is why the caller has to convert before it reaches here.
		eq( Pdf::jpeg_size( "\x89PNG\r\n\x1a\n" . str_repeat( 'x', 64 ) ), null, 'un PNG' );
	} );

	it( 'says whether the image went in, and writes nothing when it did not', function () {
		$good = new Pdf();
		truthy( $good->image( ts_pdf_jpeg_rgb(), 20, 40, 80, 60 ), 'un JPEG valable a été refusé' );

		$bad = new Pdf();
		eq( $bad->image( 'not a jpeg at all', 20, 40, 80, 60 ), false, 'des octets quelconques ont été acceptés' );
		$out = $bad->render( 'essai', 'D:20260819000000+00' );
		truthy( false === strpos( $out, '/Subtype /Image' ), 'un objet image écrit malgré le refus' );
		truthy( false === strpos( ts_pdf_page_ops( $out ), ' Do Q' ), 'un appel de dessin écrit malgré le refus' );
	} );

	it( 'fits the image inside its box and never stretches it', function () {
		/*
		 * A proof is a document about proportions, so the box is a maximum and
		 * never a shape. 6 x 4 into an 80 x 60 box is limited by the width, so
		 * it comes out 80 x 53,33 and is centred in the 6,67 mm of height it
		 * does not fill. Read off the transform, which is what a reader acts on.
		 */
		$pdf = new Pdf();
		$pdf->image( ts_pdf_jpeg_rgb(), 20.0, 40.0, 80.0, 60.0 );
		$ops = ts_pdf_page_ops( $pdf->render( 'essai', 'D:20260819000000+00' ) );

		truthy( (bool) preg_match( '/q ([0-9.]+) 0 0 ([0-9.]+) ([0-9.]+) ([0-9.]+) cm/', $ops, $m ), 'aucune transformation' );
		$mm = 72 / 25.4;
		near( (float) $m[1] / $mm, 80.0, 0.01, 'largeur posée' );
		near( (float) $m[2] / $mm, 53.3333, 0.01, 'hauteur posée, rapport conservé' );
		near( (float) $m[3] / $mm, 20.0, 0.01, 'bord gauche' );
		// Bottom-left origin: 297 moins (40 + 3,333 de centrage + 53,333).
		near( (float) $m[4] / $mm, 297.0 - ( 40.0 + 3.3333 + 53.3333 ), 0.01, 'bord bas, image centrée dans sa boîte' );
	} );

	it( 'declares the image the page draws, in that page resources', function () {
		// A page that draws an XObject it did not name in its own resources is
		// a broken file, and readers differ on how loudly they say so.
		$pdf = new Pdf();
		$pdf->image( ts_pdf_jpeg_rgb(), 20, 40, 80, 60 );
		$out = $pdf->render( 'essai', 'D:20260819000000+00' );

		truthy( (bool) preg_match( '#/XObject << /Im1 ([0-9]+) 0 R >>#', $out, $m ), 'la page ne nomme pas l’image' );
		truthy( (bool) preg_match( '/\b' . $m[1] . ' 0 obj\s*<< \/Type \/XObject/', $out ), 'l’objet nommé n’existe pas' );
		truthy( false !== strpos( $out, '/Filter /DCTDecode' ), 'les octets ne passent pas tels quels' );
		truthy( false !== strpos( $out, '/ColorSpace /DeviceRGB' ), 'espace colorimétrique' );
		eq( strlen( ts_pdf_jpeg_rgb() ), 694, 'la taille du flux annoncée doit être celle des octets' );
		truthy( false !== strpos( $out, '/Length 694 >>' ), 'la longueur déclarée n’est pas celle du JPEG' );
	} );
} );
