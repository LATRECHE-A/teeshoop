<?php
/**
 * The colour measurement.
 *
 * Every image here is BUILT, pixel by pixel, so the arithmetic is checked
 * against a colour we know rather than against a photograph we hope about. GD
 * is never touched: `Swatch` takes packed integers, which is the whole reason
 * it can be tested on a machine that has neither GD nor WordPress.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

/*
 * COMMAND LINE ONLY. `wp-content/plugins/` is served by URL and this directory
 * is inside it: without this, GET on this file runs the suite to the public
 * internet and prints the figures of every failing assertion.
 *
 * Every other file here has carried this since the guards went in. This one
 * arrived after them and did not, and `scripts/wp-e2e-verify.mjs` caught it
 * because that check enumerates the directory instead of a hard-coded list,
 * which is exactly the reason it was written that way.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Swatch.php';

use Teeshoop\Core\Swatch;

/**
 * A frame of $bg with a rectangle of $fg in the middle.
 *
 * @param array<int,array{0:int,1:int,2:int,3:int,4:int,5:int,6:int}> $rects
 *        x0, y0, x1, y1, r, g, b, inclusive.
 * @return int[]
 */
function swatch_frame( int $w, int $h, array $bg, array $rects ): array {
	$pixels = array_fill( 0, $w * $h, ( $bg[0] << 16 ) | ( $bg[1] << 8 ) | $bg[2] );
	foreach ( $rects as $rect ) {
		list( $x0, $y0, $x1, $y1, $r, $g, $b ) = $rect;
		for ( $y = max( 0, $y0 ); $y <= min( $h - 1, $y1 ); $y++ ) {
			for ( $x = max( 0, $x0 ); $x <= min( $w - 1, $x1 ); $x++ ) {
				$pixels[ $y * $w + $x ] = ( $r << 16 ) | ( $g << 8 ) | $b;
			}
		}
	}
	return $pixels;
}

/** A 64 x 64 white frame with a 40 x 40 subject of one colour. */
function swatch_subject( int $r, int $g, int $b ): array {
	return swatch_frame( 64, 64, array( 255, 255, 255 ), array( array( 12, 12, 51, 51, $r, $g, $b ) ) );
}

describe( 'Swatch: the colour space', function () {

	it( 'puts the sRGB primaries where Ottosson says they are', function () {
		list( , , $red ) = Swatch::oklch( Swatch::oklab( 255, 0, 0 ) );
		near( $red, 29.23, 0.05, 'pure red hue' );

		list( , , $blue ) = Swatch::oklch( Swatch::oklab( 0, 0, 255 ) );
		near( $blue, 264.05, 0.05, 'pure blue hue' );

		list( $white ) = Swatch::oklch( Swatch::oklab( 255, 255, 255 ) );
		near( $white, 1.0, 0.001, 'white lightness' );

		list( $black, $chroma ) = Swatch::oklch( Swatch::oklab( 0, 0, 0 ) );
		near( $black, 0.0, 1e-9, 'black lightness' );
		near( $chroma, 0.0, 1e-9, 'black chroma' );
	} );

	it( 'round-trips every channel back to the byte it came from', function () {
		foreach ( array( array( 0, 0, 0 ), array( 255, 255, 255 ), array( 35, 84, 201 ), array( 139, 69, 19 ), array( 1, 254, 128 ) ) as $rgb ) {
			$back = Swatch::srgb( Swatch::oklab( ...$rgb ) );
			eq( $back, $rgb, 'round trip of rgb(' . implode( ',', $rgb ) . ')' );
		}
	} );

	it( 'writes six lower-case digits, always', function () {
		eq( Swatch::hex( Swatch::oklab( 0, 0, 0 ) ), '#000000' );
		eq( Swatch::hex( Swatch::oklab( 255, 255, 255 ) ), '#ffffff' );
		eq( Swatch::hex( Swatch::oklab( 35, 84, 201 ) ), '#2354c9' );
	} );
} );

describe( 'Swatch: the families', function () {

	$family = static fn( int $r, int $g, int $b ): string => Swatch::family( Swatch::oklab( $r, $g, $b ) );

	it( 'names the obvious ones', function () use ( $family ) {
		eq( $family( 255, 255, 255 ), 'blanc' );
		eq( $family( 20, 20, 20 ), 'noir' );
		eq( $family( 150, 150, 150 ), 'gris' );
		eq( $family( 214, 30, 30 ), 'rouge' );
		eq( $family( 255, 140, 0 ), 'orange' );
		eq( $family( 245, 220, 30 ), 'jaune' );
		eq( $family( 30, 160, 60 ), 'vert' );
		eq( $family( 30, 70, 190 ), 'bleu' );
		eq( $family( 130, 40, 200 ), 'violet' );
		eq( $family( 230, 60, 150 ), 'rose' );
	} );

	/*
	 * THE ANCHOR SET, and the reason it exists.
	 *
	 * Every hue boundary in this file is fitted to the catalogue's own labelled
	 * dyes, which is right, and which can drift off a colour no garment happens
	 * to be. It did: a yellow/green boundary at 107,7 separated every
	 * fluorescent yellow from every lime in the catalogue correctly, and called
	 * rgb(255,255,0) a green. These eight are not negotiable by any dye.
	 */
	it( 'pins the sRGB references, which no dye may drag off', function () use ( $family ) {
		eq( $family( 255, 0, 0 ), 'rouge', 'pure red, h=29,2' );
		eq( $family( 255, 128, 0 ), 'orange', 'pure orange, h=53,0' );
		eq( $family( 255, 255, 0 ), 'jaune', 'pure yellow, h=109,8' );
		eq( $family( 0, 255, 0 ), 'vert', 'pure green, h=142,5' );
		eq( $family( 0, 255, 255 ), 'vert', 'cyan, filed with the greens' );
		eq( $family( 0, 0, 255 ), 'bleu', 'pure blue, h=264,1' );
		eq( $family( 128, 0, 255 ), 'violet', 'a full violet, h=293,9' );
		eq( $family( 255, 0, 255 ), 'rose', 'magenta, filed with the pinks' );
	} );

	/*
	 * The next six are the boundaries this session moved, each held by the two
	 * catalogue colours that decided where it goes. Break one and the test names
	 * the garment that pays for it.
	 */
	it( 'stops the reds where the catalogue stops calling them red', function () use ( $family ) {
		// Reds reach h=29,16 and oranges start at 31,53. At the old 40,0 all
		// three of these were reds, « Orange » included.
		eq( $family( 228, 27, 19 ), 'rouge', 'Tomato Red, h=29,16' );
		eq( $family( 208, 76, 55 ), 'orange', 'Sunset Orange, h=31,53' );
		eq( $family( 208, 80, 31 ), 'orange', 'Orange, h=39,18' );
	} );

	it( 'keeps the purples out of the blues', function () use ( $family ) {
		// Blues reach h=276,2 and violets start at 278,7. At the old 285,0
		// « Purple », « Violet », « Dark Purple » and « Urban Purple » were blues.
		eq( $family( 31, 34, 51 ), 'bleu', 'Navy Pure, h=276,18' );
		eq( $family( 28, 21, 91 ), 'violet', 'Dark Purple, h=278,70' );
	} );

	it( 'puts the limes with the greens without taking pure yellow with them', function () use ( $family ) {
		eq( $family( 227, 220, 16 ), 'jaune', 'Flo Yellow, h=107,33' );
		eq( $family( 255, 255, 0 ), 'jaune', 'pure yellow, h=109,77' );
		eq( $family( 209, 221, 123 ), 'vert', 'Lime, h=114,97' );
	} );

	it( 'calls a pale warm tint a cream and a darker one a beige', function () use ( $family ) {
		// The beiges stop at L_CLAIR. « Sunshine » was published as a brown.
		eq( $family( 241, 229, 177 ), 'jaune', 'Sunshine, L=0,919' );
		eq( $family( 247, 187, 150 ), 'brun', 'Union Beige, L=0,838' );
	} );

	it( 'does not let a near-black earn a hue by being dark', function () use ( $family ) {
		// C/L rises as L falls, so without the floor on the denominator these
		// three were published as a blue, a blue and a blue.
		eq( $family( 54, 65, 71 ), 'gris', 'Titanium, C=0,018' );
		eq( Swatch::family_for( Swatch::oklab( 0, 6, 16 ), 'Pitch Black' ), 'noir', 'Pitch Black, C=0,031' );
		eq( $family( 55, 61, 73 ), 'bleu', 'Ink, C=0,022, which is still a navy' );
	} );

	it( 'separates pink from red on lightness, and on nothing else', function () use ( $family ) {
		// Six thousandths of lightness between these two, and the chroma bound
		// the published model uses would have made the fuchsia a red.
		eq( $family( 177, 9, 61 ), 'rouge', 'Red/Snowwhite, L=0,487' );
		eq( $family( 175, 0, 105 ), 'rose', 'Dark Pink, L=0,493' );
		eq( $family( 235, 0, 119 ), 'rose', 'Fuchsia Organic, C=0,245' );
		eq( $family( 236, 22, 30 ), 'rouge', 'Fire Red, C=0,237 at h=27,5' );
	} );

	it( 'starts the browns where the oranges start, not inside the reds', function () use ( $family ) {
		// The earth band used to open at h=16,0, one degree above « Deep Red »
		// and just below « Cardinal Red », so one was a red and the other a brown.
		eq( $family( 132, 33, 51 ), 'rouge', 'Deep Red, h=15,07' );
		eq( $family( 130, 36, 50 ), 'rouge', 'Cardinal Red, h=16,38' );
		eq( $family( 139, 69, 19 ), 'brun', 'saddle brown, h=52,6' );
	} );

	/*
	 * These six are why a chroma threshold cannot do this job. Each is a real
	 * measurement from the catalogue, and each one is on the wrong side of some
	 * simpler rule that was tried first.
	 */
	it( 'keeps navy out of the greys, where its chroma alone would put it', function () use ( $family ) {
		// Measured on the mirror: L=0,257 C=0,028. Off-white measures C=0,020,
		// so no chroma cut separates them. Their saturations are 0,109 and 0,022.
		eq( $family( 28, 40, 66 ), 'bleu', 'navy' );
		eq( $family( 240, 236, 228 ), 'blanc', 'off-white' );
	} );

	it( 'calls a dark orange brown and a pale one beige', function () use ( $family ) {
		eq( $family( 139, 69, 19 ), 'brun', 'saddle brown, the same hue as pure orange' );
		eq( $family( 222, 184, 135 ), 'brun', 'beige, the same hue again, pale and washed out' );
		eq( $family( 255, 128, 0 ), 'orange', 'and pure orange is still orange' );
	} );

	it( 'calls a dark yellow olive, and files it with the greens', function () use ( $family ) {
		// rgb(128,128,0) is EXACTLY pure yellow's hue at half its lightness.
		// Nothing but lightness can separate them, and the trade calls the dark
		// one kaki.
		eq( $family( 128, 128, 0 ), 'vert' );
		eq( $family( 255, 255, 0 ), 'jaune' );
	} );

	it( 'keeps burgundy in the reds rather than in the browns', function () use ( $family ) {
		// Dark and warm, like a brown, but saturated, which a brown is not.
		// Saddle brown measures 0,238 of saturation and bordeaux 0,401.
		eq( $family( 128, 0, 32 ), 'rouge', 'bordeaux' );
		eq( $family( 214, 30, 30 ), 'rouge', 'a plain dark red' );
		eq( $family( 145, 80, 66 ), 'brun', 'and a brick brown is still a brown' );
	} );

	it( 'keeps a light red in the pinks and a dark one in the reds', function () use ( $family ) {
		// Wang and Luo gate pink on lightness, and this is why: raspberry
		// measures L=0,597 at h=7,2 and bordeaux L=0,380 at h=18,6. Eleven
		// degrees apart, two families, and only lightness can tell them apart.
		eq( $family( 214, 79, 140 ), 'rose', 'raspberry' );
		eq( $family( 128, 0, 32 ), 'rouge', 'bordeaux' );
	} );

	it( 'is not decided by an absolute chroma, which cannot do this job', function () use ( $family ) {
		// The published achromatic gate is C*ab <= 5, which is OKLab C ~ 0,014,
		// and its looser working figure is 0,030. This catalogue's navy is
		// C=0,028 at L=0,257 and its off-white is C=0,020 at L=0,909: at 0,014
		// the off-white is an orange, at 0,030 the navy is a black, and no
		// value between them works either. Saturation separates them at 0,109
		// against 0,022.
		$navy      = Swatch::oklab( 28, 40, 66 );
		$off_white = Swatch::oklab( 240, 236, 228 );
		list( , $c_navy ) = Swatch::oklch( $navy );
		list( , $c_white ) = Swatch::oklch( $off_white );
		truthy( $c_navy > $c_white, 'the navy is the MORE chromatic of the two' );
		eq( Swatch::family( $navy ), 'bleu' );
		eq( Swatch::family( $off_white ), 'blanc' );
	} );

	it( 'never divides by a zero lightness', function () use ( $family ) {
		eq( $family( 0, 0, 0 ), 'noir' );
	} );
} );

describe( 'Swatch: measuring one photograph', function () {

	it( 'measures a plain garment on a plain ground', function () {
		$out = Swatch::measure( swatch_subject( 35, 84, 201 ), 64, 64 );
		truthy( $out['ok'], $out['why'] );
		eq( count( $out['stops'] ), 1 );
		eq( Swatch::hex( $out['stops'][0] ), '#2354c9' );
	} );

	/*
	 * THE TEST THAT DECIDES THE WHOLE DESIGN.
	 *
	 * A white t-shirt is photographed on a white ground, and its own highlights
	 * ARE the ground colour. Every threshold on « how far is this pixel from
	 * white » deletes the garment. The fill is CONNECTED from the frame's edge,
	 * so it cannot reach the middle of the shirt, and this passes.
	 */
	it( 'measures a white garment on a white ground', function () {
		// « Snowwhite » photographs at about this, 9,9 away from the ground.
		$out = Swatch::measure( swatch_subject( 250, 250, 248 ), 64, 64 );
		truthy( $out['ok'], $out['why'] );
		eq( Swatch::hex( $out['stops'][0] ), '#fafaf8' );
	} );

	/*
	 * AND THE TEST THAT PROVES IT IS THE CONNECTION DOING THE WORK.
	 *
	 * A blown highlight on a shoulder is pixel-for-pixel the ground colour. A
	 * rule that removes « everything that looks like the ground » cuts a hole
	 * in the garment and takes the top of its lightness range with it. A fill
	 * that can only enter from the frame's edge cannot reach a hole surrounded
	 * by shirt, so the highlight stays and the share stays whole.
	 */
	it( 'keeps a highlight that is exactly the ground colour', function () {
		$pixels = swatch_frame(
			64,
			64,
			array( 255, 255, 255 ),
			array(
				array( 12, 12, 51, 51, 120, 130, 140 ),
				array( 26, 26, 37, 37, 255, 255, 255 ),
			)
		);
		$out = Swatch::measure( $pixels, 64, 64 );
		truthy( $out['ok'], $out['why'] );
		// 36 x 36 after the erosion, out of 64 x 64, highlight included.
		near( $out['share'], 1296 / 4096, 0.005, 'the highlight is still part of the garment' );
	} );

	it( 'is not fooled by a highlight and a shadow, where a mean would be', function () {
		// A body of one colour, a blown highlight on one shoulder and a deep
		// shadow under the other, each an eighth of the garment.
		$pixels = swatch_frame(
			64,
			64,
			array( 255, 255, 255 ),
			array(
				array( 12, 12, 51, 51, 60, 90, 160 ),
				array( 12, 12, 51, 21, 199, 219, 249 ),
				array( 12, 44, 51, 51, 10, 18, 40 ),
			)
		);
		$out = Swatch::measure( $pixels, 64, 64 );
		truthy( $out['ok'], $out['why'] );
		eq( Swatch::hex( $out['stops'][0] ), '#3c5aa0', 'the body colour, not the average of the three' );
	} );

	it( 'refuses a ground that is not uniform', function () {
		// A vertical gradient behind the garment: a lifestyle shot, in effect.
		$pixels = swatch_subject( 35, 84, 201 );
		for ( $y = 0; $y < 64; $y++ ) {
			for ( $x = 0; $x < 64; $x++ ) {
				if ( $x < 12 || $x > 51 || $y < 12 || $y > 51 ) {
					$v                      = 120 + (int) ( $y * 2 );
					$pixels[ $y * 64 + $x ] = ( min( 255, $v ) << 16 ) | ( min( 255, $v ) << 8 ) | min( 255, $v );
				}
			}
		}
		$out = Swatch::measure( $pixels, 64, 64 );
		eq( $out['ok'], false );
		eq( $out['why'], 'fond non uniforme' );
	} );

	it( 'refuses a subject too small to be a garment', function () {
		$pixels = swatch_frame( 64, 64, array( 255, 255, 255 ), array( array( 28, 28, 35, 35, 35, 84, 201 ) ) );
		$out    = Swatch::measure( $pixels, 64, 64 );
		eq( $out['ok'], false );
		eq( $out['why'], 'sujet absent ou trop petit' );
	} );

	/*
	 * THE GATE THAT COULD NOT FIRE, AND NOW CAN.
	 *
	 * The first version capped the subject at 97 % of the frame after eroding
	 * it by two pixels, which on any real frame costs about 3 %: the cap sat
	 * exactly where nothing could reach it. Asked the other way round, « did
	 * the fill find a ground at all », it is reachable, and this is the frame
	 * that reaches it: a two pixel border and garment everywhere else.
	 */
	it( 'refuses a frame that is not a cut-out', function () {
		// 128 x 128 with a two pixel border: the ring is uniform, so the ground
		// check is the only thing that can refuse this, and it is 6,2 % of the
		// frame against the tenth a real cut-out leaves.
		$pixels = swatch_frame( 128, 128, array( 255, 255, 255 ), array( array( 2, 2, 125, 125, 35, 84, 201 ) ) );
		$out    = Swatch::measure( $pixels, 128, 128 );
		eq( $out['ok'], false );
		eq( $out['why'], 'aucun fond détecté' );
	} );

	it( 'refuses an image it cannot read at all', function () {
		eq( Swatch::measure( array(), 0, 0 )['why'], 'image illisible' );
		eq( Swatch::measure( array( 1, 2, 3 ), 64, 64 )['why'], 'image illisible' );
	} );

	it( 'finds two colours on a two-tone garment', function () {
		// A navy body with white sleeves, which is « Navy/White ».
		$pixels = swatch_frame(
			64,
			64,
			array( 255, 255, 255 ),
			array(
				array( 12, 12, 51, 51, 28, 40, 90 ),
				array( 12, 12, 23, 51, 245, 245, 245 ),
				array( 40, 12, 51, 51, 245, 245, 245 ),
			)
		);
		$out = Swatch::measure( $pixels, 64, 64 );
		truthy( $out['ok'], $out['why'] );
		eq( count( $out['stops'] ), 2, 'two stops' );
		eq( Swatch::hex( $out['stops'][0] ), '#f5f5f5', 'the larger area first' );
		eq( Swatch::hex( $out['stops'][1] ), '#1c285a' );
	} );

	it( 'does not call a shadow a second colour', function () {
		/*
		 * One dye across a smooth ramp, which is every photograph ever taken.
		 * This is the case that killed the first two-tone test: k-means cuts a
		 * ramp in half and the two centres always land far apart compared with
		 * the scatter around them, so a separation-to-scatter ratio said « two
		 * colours » on one dye every single time. The gap test looks at what is
		 * BETWEEN them, and a ramp fills it.
		 */
		$pixels = swatch_subject( 35, 84, 201 );
		for ( $y = 12; $y <= 51; $y++ ) {
			for ( $x = 12; $x <= 51; $x++ ) {
				$k                      = 1.0 - ( $x - 12 ) / 78.0;
				$pixels[ $y * 64 + $x ] = ( (int) ( 35 * $k ) << 16 ) | ( (int) ( 84 * $k ) << 8 ) | (int) ( 201 * $k );
			}
		}
		$out = Swatch::measure( $pixels, 64, 64 );
		truthy( $out['ok'], $out['why'] );
		eq( count( $out['stops'] ), 1, 'one dye, however it is lit' );
	} );

	/*
	 * A HARD SHADOW IS BIMODAL WITH AN EMPTY MIDDLE, exactly like two dyes, so
	 * the gap cannot tell them apart: measured on this frame it reads 0,0000 and
	 * the separation is 0,118, over SEP_MIN. What separates them is that a light
	 * scales the whole OKLab vector, so hue and C/L survive it: these two centres
	 * are half a degree and 0,0003 apart, where two real dyes are 122 degrees or
	 * 0,088 apart.
	 */
	it( 'does not publish a hard shadow as the garment’s second colour', function () {
		$px = swatch_frame(
			200,
			200,
			array( 255, 255, 255 ),
			array(
				array( 30, 30, 169, 169, 120, 180, 230 ),
				// The same dye at 60 % of the light, over 30 % of the garment.
				array( 30, 30, 169, 71, 94, 143, 183 ),
			)
		);
		$out = Swatch::measure( $px, 200, 200 );
		truthy( ! empty( $out['ok'] ), 'the garment is measured' );
		eq( count( $out['stops'] ), 1, 'and it is one colour, not a colour and its shadow' );
	} );

	it( 'still finds two dyes when a shadow lies across both of them', function () {
		// Navy body, white sleeves, and a ramp over the whole thing. Both the
		// old test and the new one have to survive this or the gap test has
		// simply turned two-tone detection off.
		$pixels = swatch_frame(
			64,
			64,
			array( 255, 255, 255 ),
			array(
				array( 12, 12, 51, 51, 28, 40, 90 ),
				array( 12, 12, 23, 51, 245, 245, 245 ),
				array( 40, 12, 51, 51, 245, 245, 245 ),
			)
		);
		for ( $y = 12; $y <= 51; $y++ ) {
			for ( $x = 12; $x <= 51; $x++ ) {
				$i                = $y * 64 + $x;
				$k                = 1.0 - ( $y - 12 ) / 130.0;
				$pixels[ $i ]     = ( (int) ( ( ( $pixels[ $i ] >> 16 ) & 255 ) * $k ) << 16 )
					| ( (int) ( ( ( $pixels[ $i ] >> 8 ) & 255 ) * $k ) << 8 )
					| (int) ( ( $pixels[ $i ] & 255 ) * $k );
			}
		}
		$out = Swatch::measure( $pixels, 64, 64 );
		truthy( $out['ok'], $out['why'] );
		eq( count( $out['stops'] ), 2, 'two dyes under one lamp' );
	} );

	it( 'measures the same pixels the same way twice', function () {
		$pixels = swatch_subject( 90, 150, 60 );
		eq( Swatch::measure( $pixels, 64, 64 ), Swatch::measure( $pixels, 64, 64 ) );
	} );
} );

describe( 'Swatch: the supplier\'s own colour chip', function () {

	it( 'reads a flat chip exactly', function () {
		$out = Swatch::chip( array_fill( 0, 64 * 48, ( 2 << 16 ) | ( 42 << 8 ) | 93 ), 64, 48 );
		truthy( $out['ok'], $out['why'] );
		eq( Swatch::hex( $out['stops'][0] ), '#022a5d', 'the dye, to the byte' );
		near( $out['share'], 1.0, 1e-9, 'entirely flat' );
	} );

	it( 'ignores the ringing at the frame, which is where it is', function () {
		// MEASURED on eleven real chips: 99,2 % of the frame is one colour and
		// the rest is at the edge, where the JPEG rings. A marginal median does
		// not move for it, which is why there is no border trim: one was
		// written, and breaking it on purpose broke no test.
		$pixels = array_fill( 0, 64 * 48, ( 195 << 16 ) | ( 24 << 8 ) | 32 );
		for ( $x = 0; $x < 64; $x++ ) {
			$pixels[ $x ]            = 0xFFFFFF;
			$pixels[ 47 * 64 + $x ]  = 0x000000;
		}
		$out = Swatch::chip( $pixels, 64, 48 );
		truthy( $out['ok'], $out['why'] );
		eq( Swatch::hex( $out['stops'][0] ), '#c31820' );
	} );

	it( 'finds both halves of a two-tone chip', function () {
		$pixels = swatch_frame(
			64,
			48,
			array( 255, 255, 255 ),
			array( array( 0, 0, 31, 47, 28, 40, 90 ), array( 32, 0, 63, 47, 245, 245, 245 ) )
		);
		$out = Swatch::chip( $pixels, 64, 48 );
		truthy( $out['ok'], $out['why'] );
		eq( count( $out['stops'] ), 2 );
	} );

	/*
	 * THE GATE THAT KEEPS THE TWO SOURCES APART.
	 *
	 * If a photograph of a garment ever arrives in the chip field, the flat
	 * median of it is the colour of the BACKDROP, and a catalogue of white
	 * swatches would look entirely plausible. A cut-out on white is a little
	 * over half ground, so it cannot clear the flatness floor.
	 */
	/*
	 * A CUT-OUT DOES NOT HAVE TO BE FLOATING TO BE A CUT-OUT. The first version
	 * of the test asked « does one colour touch all four sides and the other
	 * none », which a single sleeve reaching an edge answers wrong, and the
	 * backdrop is then published as the garment's colour. The border ring says
	 * it properly: measured, this frame gives the subject 0,065 of the ring and
	 * the smallest real chip in the catalogue gives its minor half 0,219.
	 */
	it( 'refuses a cut-out whose sleeve reaches the frame edge', function () {
		$px = swatch_frame(
			168,
			126,
			array( 255, 255, 255 ),
			array(
				array( 30, 20, 137, 105, 28, 40, 66 ),
				array( 0, 45, 30, 82, 28, 40, 66 ),
			)
		);
		$out = Swatch::chip( $px, 168, 126 );
		truthy( empty( $out['ok'] ), 'a cut-out touching one edge is still a cut-out' );
		eq( $out['why'], 'ce n’est pas une pastille, c’est un vêtement détouré' );
	} );

	it( 'keeps a real two-tone chip whose halves are one grey and a darker one', function () {
		/*
		 * « Charcoal Heather » really is #4e4e4e and #292929: two greys, so their
		 * hue and their saturation are IDENTICAL and the one-dye-under-two-lights
		 * rule matches them exactly. It must not run here. A chip is an aplat and
		 * has no light in it to explain a second tone away, and five of this
		 * catalogue's forty-two two-tone chips are a pair of neutrals.
		 */
		$px  = swatch_frame( 168, 126, array( 78, 78, 78 ), array( array( 0, 63, 167, 125, 41, 41, 41 ) ) );
		$out = Swatch::chip( $px, 168, 126 );
		truthy( ! empty( $out['ok'] ), 'a half-and-half chip is a chip' );
		eq( count( $out['stops'] ), 2, 'and it keeps both its colours' );
	} );

	it( 'refuses a garment photograph offered as a chip', function () {
		$out = Swatch::chip( swatch_subject( 35, 84, 201 ), 64, 64 );
		eq( $out['ok'], false );
		eq( $out['why'], 'ce n’est pas une pastille, c’est un vêtement détouré' );
	} );

	it( 'refuses an image that is neither flat nor split', function () {
		// A gradient across the whole frame: one cluster, and almost none of it
		// sits on the median.
		$pixels = array();
		for ( $y = 0; $y < 48; $y++ ) {
			for ( $x = 0; $x < 64; $x++ ) {
				$v        = (int) round( 255 * $x / 63 );
				$pixels[] = ( $v << 16 ) | ( $v << 8 ) | $v;
			}
		}
		$out = Swatch::chip( $pixels, 64, 48 );
		eq( $out['ok'], false );
		eq( $out['why'], 'la pastille fournisseur n’est pas une teinte unie' );
	} );

	it( 'refuses something it cannot read', function () {
		eq( Swatch::chip( array(), 0, 0 )['why'], 'image illisible' );
	} );
} );

describe( 'Swatch: putting several photographs together', function () {

	$photo = static fn( array $lab, int $n = 1 ): array => array(
		'ok'      => true,
		'why'     => '',
		'stops'   => 1 === $n ? array( $lab ) : array( $lab, array( 0.95, 0.0, 0.0 ) ),
		'share'   => 0.4,
		'scatter' => 0.02,
	);
	$navy  = Swatch::oklab( 28, 40, 66 );

	it( 'says why when it could not look, and does not say « grey »', function () {
		$out = Swatch::aggregate(
			array(
				array( 'ok' => false, 'why' => 'fond non uniforme', 'stops' => array() ),
				array( 'ok' => false, 'why' => 'fond non uniforme', 'stops' => array() ),
				array( 'ok' => false, 'why' => 'image illisible', 'stops' => array() ),
			)
		);
		eq( $out['ok'], false );
		eq( $out['why'], 'fond non uniforme', 'the reason most photographs gave' );
		eq( $out['stops'], array() );
		eq( $out['family'], '', 'no family, which is not the same as a grey one' );
	} );

	it( 'has no opinion at all when there were no photographs', function () {
		eq( Swatch::aggregate( array() )['why'], 'aucune photo' );
	} );

	it( 'drops one odd photograph and keeps the other four', function () use ( $photo, $navy ) {
		$odd = Swatch::oklab( 200, 60, 60 );
		$out = Swatch::aggregate(
			array( $photo( $navy ), $photo( $navy ), $photo( $odd ), $photo( $navy ), $photo( $navy ) )
		);
		truthy( $out['ok'], $out['why'] );
		eq( $out['photos'], 4, 'four photographs agreed' );
		eq( $out['seen'], 5, 'five were looked at' );
		eq( $out['stops'][0], Swatch::hex( $navy ) );
	} );

	it( 'refuses when no majority agrees on anything', function () use ( $photo ) {
		$out = Swatch::aggregate(
			array(
				$photo( Swatch::oklab( 240, 240, 240 ) ),
				$photo( Swatch::oklab( 20, 20, 20 ) ),
				$photo( Swatch::oklab( 200, 40, 40 ) ),
				$photo( Swatch::oklab( 40, 200, 40 ) ),
			)
		);
		eq( $out['ok'], false );
		eq( $out['why'], 'photos discordantes' );
	} );

	it( 'publishes two stops only when most photographs saw two', function () use ( $photo, $navy ) {
		eq( count( Swatch::aggregate( array( $photo( $navy, 2 ), $photo( $navy, 2 ), $photo( $navy ) ) )['stops'] ), 2 );
		eq( count( Swatch::aggregate( array( $photo( $navy, 2 ), $photo( $navy ), $photo( $navy ) ) )['stops'] ), 1 );
	} );
} );

describe( 'Swatch: what the name is allowed to say', function () {

	it( 'reads one family from an unambiguous name', function () {
		eq( Swatch::name_family( 'French Navy' ), 'bleu' );
		eq( Swatch::name_family( 'Light Grey Marl' ), 'gris' );
		eq( Swatch::name_family( 'Bottle Green' ), 'vert' );
		eq( Swatch::name_family( 'Snowwhite' ), 'blanc' );
	} );

	it( 'says nothing about a name nobody agrees on', function () {
		// Each of these was in the list once and each was refusing a good
		// measurement for disagreeing with an opinion.
		foreach ( array( 'Turquoise', 'Real Turquoise', 'Aqua', 'Coral', 'Salmon', 'Rust', 'Taupe', 'Natural', 'Peach' ) as $name ) {
			eq( Swatch::name_family( $name ), '', $name );
		}
	} );

	it( 'says nothing about a name that means nothing', function () {
		eq( Swatch::name_family( 'Atoll' ), '' );
		eq( Swatch::name_family( 'Iron' ), '' );
		eq( Swatch::name_family( 'Mocha' ), 'brun' );
	} );

	it( 'reads a two-tone name as both of its colours, and Navy/Navy as one', function () {
		eq( Swatch::name_families( 'Navy/White' ), array( 'blanc', 'bleu' ) );
		eq( Swatch::name_families( 'Navy/Navy' ), array( 'bleu' ) );
		eq( Swatch::name_families( 'Grey/Lime' ), array( 'gris', 'vert' ) );
	} );

	it( 'is not fooled by a word inside another word', function () {
		// « Ash » must not be found inside « Washed », nor « or » inside
		// « Forest ». The list is matched on whole words for this reason.
		eq( Swatch::name_family( 'Washed Denim' ), 'bleu' );
		eq( Swatch::name_family( 'Forest' ), 'vert' );
	} );
} );

describe( 'Swatch: the last gate', function () {

	$ok = static fn( array $lab ): array => array(
		'ok'     => true,
		'why'    => '',
		'stops'  => array( Swatch::hex( $lab ) ),
		'lab'    => $lab,
		'labs'   => array( $lab ),
		'family' => Swatch::family( $lab ),
		'photos' => 3,
		'seen'   => 3,
		'spread' => 0.01,
	);

	it( 'refuses when the photograph and the label disagree', function () use ( $ok ) {
		$out = Swatch::verify( $ok( Swatch::oklab( 40, 160, 60 ) ), 'French Navy' );
		eq( $out['ok'], false );
		eq( $out['stops'], array(), 'nothing is published' );
		truthy( str_contains( $out['why'], 'vert' ) && str_contains( $out['why'], 'bleu' ), $out['why'] );
	} );

	it( 'lets an unverifiable name through on the measurement alone', function () use ( $ok ) {
		truthy( Swatch::verify( $ok( Swatch::oklab( 40, 160, 60 ) ), 'Atoll' )['ok'] );
	} );

	it( 'checks a two-tone name against both of its colours', function () use ( $ok ) {
		$two = array( Swatch::oklab( 245, 245, 245 ), Swatch::oklab( 28, 40, 90 ) );
		$agg = array(
			'ok'     => true,
			'why'    => '',
			'stops'  => array( Swatch::hex( $two[0] ), Swatch::hex( $two[1] ) ),
			'lab'    => $two[0],
			'labs'   => $two,
			'family' => Swatch::family( $two[0] ),
			'photos' => 2,
			'seen'   => 2,
			'spread' => 0.01,
		);
		truthy( Swatch::verify( $agg, 'White/Navy' )['ok'], 'both stops are named' );
		eq( Swatch::verify( $agg, 'White/Red' )['ok'], false, 'the navy half is not a red' );
	} );

	it( 'catches a two-tone name whose second colour was never found', function () use ( $ok ) {
		// « Black/Red » measured as one mid grey: the red sleeves were too
		// small to cluster, and a grey is neither of the two words on the label.
		eq( Swatch::verify( $ok( Swatch::oklab( 90, 92, 96 ) ), 'Black/Red' )['ok'], false );
	} );

	/*
	 * THE TIE-BREAK, AND ITS TWO EDGES.
	 *
	 * Every disagreement this catalogue produced between the images and the
	 * maker's word is a nearly neutral colour. « Pink » measures C=0,022 at
	 * L=0,948 and « Grey Fog » measures C=0,026 at L=0,865: one is a pink and
	 * the other is a grey, they are a thousandth of chroma apart, and no image
	 * separates them. Under S_FLOU the word decides; over it, a disagreement is
	 * still an error and is still refused.
	 */
	it( 'lets the maker’s word decide a colour too pale to decide itself', function () use ( $ok ) {
		// « Pink », measured: L=0,948 C=0,0223 h=38,3. The code alone reads it
		// as a white, because at that chroma it very nearly is one.
		$pale = Swatch::oklab( 249, 236, 233 );
		eq( Swatch::family( $pale ), 'blanc', 'on its own the measurement says white' );
		eq( Swatch::family_for( $pale, 'Pink' ), 'rose', 'and the label says pink' );
		eq( Swatch::family_for( $pale, 'Grey Fog' ), 'gris', 'and on the next chip it says grey' );
		eq( Swatch::family_for( $pale, 'Atoll' ), 'blanc', 'a label that says nothing changes nothing' );
	} );

	it( 'lets a black melange be a black, which no image can tell it is', function () {
		// L=0,345 C=0,000: a mid grey, which is what a black melange looks like.
		$melange = Swatch::oklab( 88, 88, 88 );
		eq( Swatch::family( $melange ), 'gris' );
		eq( Swatch::family_for( $melange, 'Black Melange' ), 'noir' );
	} );

	it( 'still refuses a saturated colour that contradicts its own label', function () use ( $ok ) {
		// A real green called a navy is one of the two being wrong, and no
		// amount of label breaks that tie.
		$green = Swatch::oklab( 40, 160, 60 );
		eq( Swatch::family_for( $green, 'French Navy' ), 'vert', 'the measurement holds' );
		eq( Swatch::verify( $ok( $green ), 'French Navy' )['ok'], false );
	} );

	it( 'never lets the label change the swatch, only the grouping', function () use ( $ok ) {
		$pale = Swatch::oklab( 249, 236, 233 );
		$out  = Swatch::verify( $ok( $pale ), 'Pink' );
		truthy( $out['ok'] );
		eq( $out['family'], 'rose' );
		eq( $out['stops'][0], Swatch::hex( $pale ), 'the colour published is the colour measured' );
	} );

	it( 'accepts a two-tone name whose second word it does not know', function () use ( $ok ) {
		// « Black/Dolphin »: the chip is black and grey, and « Dolphin » is not
		// a word this file knows. Demanding that every measured tone be named
		// refused nine perfectly good measurements for being more complete than
		// the label.
		$two = array( Swatch::oklab( 20, 20, 20 ), Swatch::oklab( 130, 132, 136 ) );
		$agg = array(
			'ok'     => true,
			'why'    => '',
			'stops'  => array( Swatch::hex( $two[0] ), Swatch::hex( $two[1] ) ),
			'lab'    => $two[0],
			'labs'   => $two,
			'family' => Swatch::family( $two[0] ),
			'photos' => 1,
			'seen'   => 1,
			'spread' => 0.0,
		);
		truthy( Swatch::verify( $agg, 'Black/Dolphin' )['ok'], 'the unnamed second tone is not an error' );
		eq( Swatch::verify( $agg, 'Black/Red' )['ok'], false, 'a named red that is not there still is' );
	} );

	it( 'refuses a strong colour nobody named, however terse the label', function () use ( $ok ) {
		// The same shape as « Black/Dolphin », except the second half is a
		// bright red. A rule that only asked « was every named family seen »
		// would let this through, because nothing names the red.
		$two = array( Swatch::oklab( 20, 20, 20 ), Swatch::oklab( 214, 30, 30 ) );
		$agg = array(
			'ok'     => true,
			'why'    => '',
			'stops'  => array( Swatch::hex( $two[0] ), Swatch::hex( $two[1] ) ),
			'lab'    => $two[0],
			'labs'   => $two,
			'family' => Swatch::family( $two[0] ),
			'photos' => 1,
			'seen'   => 1,
			'spread' => 0.0,
		);
		eq( Swatch::verify( $agg, 'Black/Dolphin' )['ok'], false );
		truthy( Swatch::verify( $agg, 'Black/Red' )['ok'], 'and it passes the moment the label says red' );
	} );

	it( 'passes a refusal straight through', function () {
		$refused = array( 'ok' => false, 'why' => 'photos discordantes', 'stops' => array() );
		eq( Swatch::verify( $refused, 'French Navy' )['why'], 'photos discordantes' );
	} );
} );
