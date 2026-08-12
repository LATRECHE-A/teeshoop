<?php
/**
 * Stored configuration, and the safety defaults around it.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Settings {

	/**
	 * Integration settings, with defaults.
	 *
	 * `studio_origin` is a security parameter, not a convenience one: it is what
	 * bridge.js compares every incoming postMessage against, and what the iframe
	 * is told to post back to. An empty value means the bridge refuses to run
	 * rather than accepting messages from anywhere.
	 */
	public static function all(): array {
		$defaults = array(
			'studio_origin'      => '',
			'studio_path'        => '/',
			'worker_url'         => '',
			'design_verify_path' => '/api/design/',
		);

		$stored = get_option( OPTION_SETTINGS, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		return array_merge( $defaults, array_intersect_key( $stored, $defaults ) );
	}

	public static function get( string $key ): string {
		$all = self::all();
		return isset( $all[ $key ] ) ? (string) $all[ $key ] : '';
	}

	/** The price config: stored partial merged over the shipped defaults. */
	public static function pricing(): array {
		$stored = get_option( OPTION_PRICING, array() );
		return Pricing::merge_config( is_array( $stored ) ? $stored : array() );
	}

	/**
	 * The studio's origin, normalised to scheme://host[:port] and nothing else.
	 *
	 * A trailing path or slash here silently breaks every origin comparison in
	 * bridge.js — `event.origin` never carries one — and a broken comparison
	 * fails OPEN if it is written as a `startsWith`. So it is normalised once,
	 * here, and compared with `===` there.
	 */
	public static function studio_origin(): string {
		$raw = self::get( 'studio_origin' );
		if ( '' === $raw ) {
			return '';
		}

		$parts = wp_parse_url( $raw );
		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return '';
		}
		if ( ! in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true ) ) {
			return '';
		}

		$origin = strtolower( $parts['scheme'] ) . '://' . strtolower( $parts['host'] );
		if ( ! empty( $parts['port'] ) ) {
			$origin .= ':' . (int) $parts['port'];
		}
		return $origin;
	}

	/** Full URL the iframe loads, or '' when the studio origin is not configured. */
	public static function studio_url(): string {
		$origin = self::studio_origin();
		if ( '' === $origin ) {
			return '';
		}
		$path = self::get( 'studio_path' );
		if ( '' === $path || '/' !== $path[0] ) {
			$path = '/' . $path;
		}
		return $origin . $path;
	}

	/**
	 * Whether a design may be added to the cart without the Worker confirming
	 * that its files exist.
	 *
	 * FALSE by default, on purpose. An unverified design id produces an order the
	 * workshop cannot print — the customer has paid and there is nothing to press.
	 * Local development sets the constant in wp-config.php; production must not.
	 */
	public static function allow_unverified_designs(): bool {
		return defined( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS' ) && TEESHOOP_ALLOW_UNVERIFIED_DESIGNS;
	}
}
