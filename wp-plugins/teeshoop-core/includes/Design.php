<?php
/**
 * The design hand-off.
 *
 * An order line carries an IDENTIFIER. The artwork itself — the customer's
 * upload, the flattened preview, the 300 DPI print file — lives in R2, put there
 * by the studio through the Worker before the add-to-cart call is ever made.
 *
 * Two reasons it is not in the WordPress media library:
 *   · wp-content/uploads is served by URL with no access control, so a customer
 *     logo would be a guessable public file. robots.txt is not a permission.
 *   · the files are large and the shop is on shared hosting.
 *
 * And one reason the id is verified rather than trusted: the id arrives from a
 * browser. An order whose design does not exist is an order the workshop cannot
 * print, discovered after the customer has paid.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

/*
 * THE TEST HATCH REACHES TWO FUNCTIONS AND NO MORE. `normalise_pieces` and
 * `normalise_placement` are pure arithmetic on an untrusted payload and they
 * are the shop's half of a gate whose other half is a TypeScript file; the two
 * have to be proved to agree, and `tests/run.php` is where that is cheap.
 * Everything else here calls WordPress and will fatal without it, which is the
 * correct signal rather than a silent pass.
 */
defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Design {

	/**
	 * Design ids are opaque, URL-safe and bounded.
	 *
	 * Bounded matters: this string ends up in an order-item meta key lookup, in a
	 * URL to the Worker, and on a picking list. 16–64 of [A-Za-z0-9_-] is wide
	 * enough for any id scheme we would pick and narrow enough that nothing needs
	 * escaping downstream.
	 */
	public static function valid_id( string $id ): bool {
		return 1 === preg_match( '/^[A-Za-z0-9_-]{16,64}$/', $id );
	}

	/**
	 * Ask the Worker whether this design actually exists.
	 *
	 * Returns:
	 *   ['ok' => true,  'meta' => array]        the design is there
	 *   ['ok' => false, 'reason' => string]     it is not, or we could not ask
	 *
	 * A network failure is NOT treated as a pass. If the Worker cannot be reached
	 * we do not know whether the files exist, and "we do not know" must not add a
	 * paid line to a cart — unless the shop has explicitly opted out via
	 * Settings::allow_unverified_designs(), which is for local development.
	 */
	public static function verify( string $id ): array {
		if ( ! self::valid_id( $id ) ) {
			return array(
				'ok'     => false,
				'reason' => 'malformed_id',
			);
		}

		$worker = Settings::get( 'worker_url' );
		if ( '' === $worker ) {
			return Settings::allow_unverified_designs()
				? array(
					'ok'   => true,
					'meta' => array( 'verified' => false ),
				)
				: array(
					'ok'     => false,
					'reason' => 'worker_not_configured',
				);
		}

		$url = rtrim( $worker, '/' ) . Settings::get( 'design_verify_path' ) . rawurlencode( $id );

		$response = wp_remote_get(
			$url,
			array(
				'timeout'     => 5,
				'redirection' => 0,
				'headers'     => array( 'accept' => 'application/json' ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return Settings::allow_unverified_designs()
				? array(
					'ok'   => true,
					'meta' => array( 'verified' => false ),
				)
				: array(
					'ok'     => false,
					'reason' => 'worker_unreachable',
				);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( 200 !== $code ) {
			return array(
				'ok'     => false,
				'reason' => 404 === $code ? 'design_not_found' : 'worker_error_' . $code,
			);
		}

		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $body ) ) {
			return array(
				'ok'     => false,
				'reason' => 'worker_bad_json',
			);
		}

		return array(
			'ok'   => true,
			'meta' => array(
				'verified'   => true,
				'print_file' => isset( $body['print_file'] ) ? (string) $body['print_file'] : '',
				'preview'    => isset( $body['preview'] ) ? (string) $body['preview'] : '',
				/*
				 * ONE PREVIEW PER PRINTED SIDE, by side id. `preview` above is
				 * the cart thumbnail and stays what it was. These exist for the
				 * bon à tirer, which has to show every side the customer is
				 * approving; a proof showing only the front of a garment printed
				 * front and back decides nothing about the back.
				 */
				'previews'   => isset( $body['previews'] ) && is_array( $body['previews'] ) ? self::normalise_previews( $body['previews'] ) : array(),
				'sides'      => isset( $body['sides'] ) && is_array( $body['sides'] ) ? $body['sides'] : array(),
				/*
				 * THE COLOUR, because a bon à tirer has to print it and there is
				 * nowhere else it exists on this side. The manifest has carried
				 * it since the design route was written and this function threw
				 * it away; the alternative was a second `wp_remote_get` to the
				 * same URL from `Bat`, which is two readers of one fact and one
				 * more network call on the path to a customer promise.
				 *
				 * It is frozen onto the order line at add-to-cart, so issuing a
				 * proof reads the order and not the Worker.
				 */
				'garment'    => isset( $body['garment'] ) ? (string) $body['garment'] : '',
				'color'      => isset( $body['color'] ) ? (string) $body['color'] : '',
				/*
				 * WHICH BUILD RENDERED IT. The artwork is re-rendered later by
				 * whatever is deployed then (`worker/design.ts` stamps this for
				 * exactly that reason), so a proof approved under one version and
				 * a transfer pressed under another are not guaranteed to be the
				 * same pixels. This field is the only thing that would ever let
				 * anyone notice.
				 */
				'app_version' => isset( $body['app_version'] ) ? (string) $body['app_version'] : '',
			),
		);
	}

	/**
	 * The per-side preview paths, keyed by a side id we recognise.
	 *
	 * Bounded and pattern-checked because these strings end up in an `img src`
	 * on a page a customer opens: the manifest is ours, but the shop treats
	 * everything that arrives over HTTP as a claim. A path that is not one of
	 * the shapes the Worker stores is dropped, and the proof then says the
	 * mockup for that side is unavailable rather than rendering a broken image
	 * or, worse, an address somebody else chose.
	 *
	 * @return array<string,string>
	 */
	public static function normalise_previews( array $raw ): array {
		$out = array();
		foreach ( $raw as $side => $path ) {
			$id = sanitize_key( (string) $side );
			if ( '' === $id || ! is_string( $path ) ) {
				continue;
			}
			if ( ! preg_match( '#^/r2/design/[A-Za-z0-9_-]{16,64}/preview-[a-z_]{1,16}\.png$#', $path ) ) {
				continue;
			}
			$out[ $id ] = $path;
			if ( count( $out ) >= 8 ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * Normalise the per-side payload that arrives with an add-to-cart.
	 *
	 * Only the fields the price depends on survive. Everything else the studio
	 * might send — layer trees, fonts, undo history — is deliberately dropped:
	 * it belongs in the design file, not in a cart session that gets serialised
	 * into the database on every page load.
	 *
	 * At most 8 sides. A garment has four printable faces plus room to grow; a
	 * request with 400 sides is not a t-shirt.
	 *
	 * `pieces` rides along from session 05. The AREA is what the customer pays
	 * for; the RECTANGLES are what the film costs, and the two are different
	 * questions: 400 cm² of ink is one transfer or six, and six of them pack onto
	 * a 56 cm roll very differently from one. They are measured together, once,
	 * in the browser, because an ink extent comes from a decoded image's alpha
	 * and neither this server nor the Worker has a canvas.
	 */
	public static function normalise_sides( mixed $raw ): array {
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$out = array();
		foreach ( $raw as $side ) {
			if ( ! is_array( $side ) ) {
				continue;
			}
			$area = isset( $side['area_sq_cm'] ) ? (float) $side['area_sq_cm'] : 0.0;
			if ( $area <= 0 || ! is_finite( $area ) ) {
				continue;
			}
			$id = isset( $side['id'] ) ? sanitize_key( (string) $side['id'] ) : '';
			if ( '' === $id ) {
				continue;
			}

			$capped = min( $area, 10000.0 );
			$out[]  = array(
				'id'         => $id,
				// Cap at a square metre: past that it is a data error, and it
				// must not be able to drive the price to an absurd number.
				'area_sq_cm' => $capped,
			) + self::normalise_placement( $side, self::normalise_pieces( $side['pieces'] ?? null, $capped ) );

			if ( count( $out ) >= 8 ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * The transfers of one side, bounded, or an empty list.
	 *
	 * ALL OR NOTHING, the same rule as the studio's own gate
	 * (src/lib/teeshoop/designDoc.ts). A partly-read list would cost the film of
	 * the pieces that happened to parse and silently drop the rest: a film cost
	 * that is too low, so a floor price that is too low, so a sale nobody would
	 * have authorised. A side whose pieces cannot all be read has no pieces, and
	 * `Costing` then reports its film as unknown rather than as cheap.
	 *
	 * The bounds match that gate exactly (32 pieces, 200 cm, and the ink area the
	 * rectangles must be able to hold) because the two ends are reading the same
	 * document, and a shop that accepted what the Worker refused would be
	 * costing an order the workshop cannot receive.
	 *
	 * `$area_sq_cm` IS THE POINT OF THIS FUNCTION, not a detail of it. The
	 * design document arrives through an OPEN route, because a customer cannot
	 * authenticate, and these rectangles are what our film cost and therefore
	 * our floor price are computed from. Bounds on their size stop absurd
	 * values; only the comparison with the ink area stops PLAUSIBLE ones. See
	 * the long note in src/lib/teeshoop/designDoc.ts for the derivation and for
	 * the 240,98 EUR it is worth on one order.
	 */
	public static function normalise_pieces( mixed $raw, float $area_sq_cm = 0.0 ): array {
		if ( ! is_array( $raw ) || array() === $raw || count( $raw ) > 32 ) {
			return array();
		}

		$out   = array();
		$boxed = 0.0;
		foreach ( $raw as $piece ) {
			if ( ! is_array( $piece ) ) {
				return array();
			}
			$w = isset( $piece['w_cm'] ) && is_numeric( $piece['w_cm'] ) ? (float) $piece['w_cm'] : -1.0;
			$h = isset( $piece['h_cm'] ) && is_numeric( $piece['h_cm'] ) ? (float) $piece['h_cm'] : -1.0;
			if ( ! is_finite( $w ) || ! is_finite( $h ) || $w <= 0 || $h <= 0 || $w > 200 || $h > 200 ) {
				return array();
			}
			$boxed += $w * $h;
			$piece_out = array(
				'w_cm' => $w,
				'h_cm' => $h,
			);
			// Carried through unvalidated; `normalise_placement` is what decides
			// whether they are kept, because the check is per SIDE and this loop
			// only sees one rectangle at a time.
			foreach ( array( 'top_cm', 'center_dx_cm' ) as $key ) {
				if ( isset( $piece[ $key ] ) && is_numeric( $piece[ $key ] ) ) {
					$piece_out[ $key ] = (float) $piece[ $key ];
				}
			}
			$out[] = $piece_out;
		}

		// 1 % of slack for the 0,01 cm rounding both numbers carry, and nothing
		// else. Failing it drops the geometry, never the order.
		if ( $boxed < $area_sq_cm * 0.99 ) {
			return array();
		}

		return $out;
	}

	/**
	 * How far a placement may sit outside the print area it declares, cm.
	 *
	 * The producer clamps every transfer to the area exactly, so the true answer
	 * is zero and what is left is rounding: six numbers each rounded to 0,01 cm
	 * before they are written. Identical to PLACEMENT_SLACK_CM in
	 * src/lib/teeshoop/designDoc.ts, because the two ends read one document.
	 */
	private const PLACEMENT_SLACK_CM = 0.05;

	/**
	 * The side's placement: the print area, the drop below the collar, and each
	 * transfer's position inside that area.
	 *
	 * ALL OR NOTHING PER SIDE, and separate from the film geometry, which is why
	 * it is its own function on both ends. These numbers are what the bon a
	 * tirer states and what a press is set up from; they are not a price input
	 * and not a film input. A placement that cannot be read therefore drops the
	 * PLACEMENT and keeps the rectangles: the order costs what it costs, and the
	 * proof says the position was not measured instead of printing one nobody
	 * took.
	 *
	 * The fit check is what an OPEN route needs. Unlike the area and the
	 * rectangles, nothing downstream would ever notice these being wrong: a
	 * document claiming a 30 cm drop inside a 40 cm area is a print half off the
	 * shoulder, and the first thing that would catch it today is a customer
	 * opening a parcel. The bounds mirror src/lib/teeshoop/designDoc.ts exactly.
	 *
	 * @param array $side   the raw side payload.
	 * @param array $pieces what `normalise_pieces` kept, possibly empty.
	 *
	 * @return array{pieces:array,area_w_cm?:float,area_h_cm?:float,drop_cm?:float}
	 */
	public static function normalise_placement( array $side, array $pieces ): array {
		/*
		 * REFUSING A PLACEMENT MEANS NOT STORING IT. `normalise_pieces` carries
		 * the two raw numbers through so this function can see them; every path
		 * that declines them has to strip them again, or the order keeps the
		 * very numbers the fit check just rejected and the bon a tirer prints
		 * them as measured.
		 */
		$bare = array( 'pieces' => array() );
		foreach ( $pieces as $piece ) {
			$bare['pieces'][] = array(
				'w_cm' => (float) $piece['w_cm'],
				'h_cm' => (float) $piece['h_cm'],
			);
		}

		$aw = isset( $side['area_w_cm'] ) && is_numeric( $side['area_w_cm'] ) ? (float) $side['area_w_cm'] : -1.0;
		$ah = isset( $side['area_h_cm'] ) && is_numeric( $side['area_h_cm'] ) ? (float) $side['area_h_cm'] : -1.0;
		if ( ! is_finite( $aw ) || ! is_finite( $ah ) || $aw <= 0 || $ah <= 0 || $aw > 200 || $ah > 200 ) {
			return $bare;
		}
		if ( array() === $pieces ) {
			return $bare;
		}

		$placed = array();
		foreach ( $pieces as $piece ) {
			if ( ! isset( $piece['top_cm'], $piece['center_dx_cm'] ) ) {
				return $bare;
			}
			$top = (float) $piece['top_cm'];
			$dx  = (float) $piece['center_dx_cm'];
			if ( ! is_finite( $top ) || ! is_finite( $dx ) ) {
				return $bare;
			}
			if ( $top < -self::PLACEMENT_SLACK_CM || $top + (float) $piece['h_cm'] > $ah + self::PLACEMENT_SLACK_CM ) {
				return $bare;
			}
			if ( abs( $dx ) + (float) $piece['w_cm'] / 2 > $aw / 2 + self::PLACEMENT_SLACK_CM ) {
				return $bare;
			}
			$placed[] = array(
				'w_cm'         => (float) $piece['w_cm'],
				'h_cm'         => (float) $piece['h_cm'],
				'top_cm'       => $top,
				'center_dx_cm' => $dx,
			);
		}

		$out  = array(
			'pieces'    => $placed,
			'area_w_cm' => $aw,
			'area_h_cm' => $ah,
		);
		$drop = isset( $side['drop_cm'] ) && is_numeric( $side['drop_cm'] ) ? (float) $side['drop_cm'] : -1.0;
		if ( is_finite( $drop ) && $drop > 0 && $drop <= 100 ) {
			$out['drop_cm'] = $drop;
		}
		// A tri-state, deliberately: true, false, and "the document predates the
		// field". The proof says nothing about grading in the third case rather
		// than picking whichever answer is commoner.
		if ( isset( $side['graded'] ) && is_bool( $side['graded'] ) ) {
			$out['graded'] = $side['graded'];
		}
		return $out;
	}
}
