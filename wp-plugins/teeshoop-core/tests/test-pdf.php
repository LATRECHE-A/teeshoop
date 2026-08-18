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
