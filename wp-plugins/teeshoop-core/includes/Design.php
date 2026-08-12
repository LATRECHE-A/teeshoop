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

defined( 'ABSPATH' ) || exit;

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
				'sides'      => isset( $body['sides'] ) && is_array( $body['sides'] ) ? $body['sides'] : array(),
			),
		);
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

			$out[] = array(
				'id'         => $id,
				// Cap at a square metre: past that it is a data error, and it
				// must not be able to drive the price to an absurd number.
				'area_sq_cm' => min( $area, 10000.0 ),
			);

			if ( count( $out ) >= 8 ) {
				break;
			}
		}
		return $out;
	}
}
