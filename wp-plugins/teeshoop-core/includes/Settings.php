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
			// Where a quote request is announced. Empty falls back to the site
			// administrator rather than to nowhere: a request that reaches a
			// record but nobody's inbox is a customer waiting for an answer no
			// one knows to write.
			'quote_email'        => '',
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

	/**
	 * The price config: stored partial merged over the shipped defaults, with
	 * the VAT rate taken from the regime in force TODAY.
	 *
	 * That last part is the whole of the franchise support, and it is one line
	 * on purpose. Every TTC figure this shop prints, on the product page, in the
	 * grid, in the basket, in the studio's panel and on the quote form, is
	 * `Pricing::quote()`'s answer for this config. Point the rate at the regime
	 * here and all of them follow; write a franchise branch in each of them and
	 * one will be forgotten, and it will be the one on the invoice.
	 *
	 * When no period covers today the rate is left at the shipped standard one
	 * and `vat()` reports `known => false`. Nothing may be SOLD in that state:
	 * `Cart::check_cart_items` refuses the basket and `Invoice` refuses the
	 * document. The displayed rate is then an estimate on a shop that cannot
	 * take an order, which is visible, rather than a zero on a shop that can,
	 * which is not.
	 */
	public static function pricing(): array {
		$stored = get_option( OPTION_PRICING, array() );
		$config = Pricing::merge_config( is_array( $stored ) ? $stored : array() );

		$regime = Vat::regime( self::today(), self::vat_periods(), $config );
		if ( $regime['known'] ) {
			$config['vat_rate'] = $regime['rate'];
		}

		return $config;
	}

	/**
	 * The VAT regime timeline, stored partial over the shipped default.
	 *
	 * `null` as the option default, not `array()`: WordPress returns the default
	 * for an ABSENT option, and `Vat::merge_periods` has to be able to tell that
	 * apart from an option somebody has deliberately emptied. Reading the second
	 * as the first would restore 20 % over an operator who had just removed
	 * every period.
	 */
	public static function vat_periods(): array {
		return Vat::merge_periods( get_option( OPTION_VAT, null ) );
	}

	/** The regime in force today: rate, mention, whether it is known at all. */
	public static function vat(): array {
		$stored = get_option( OPTION_PRICING, array() );
		$config = Pricing::merge_config( is_array( $stored ) ? $stored : array() );
		return Vat::regime( self::today(), self::vat_periods(), $config );
	}

	/**
	 * Today, in the shop's own timezone.
	 *
	 * `wp_date` and not `date`: the server is UTC and the shop is in Paris, so
	 * an order taken at 00:30 on the day a regime changes would otherwise be
	 * invoiced under the previous day's regime. Two hours a year, on the one
	 * date where being wrong is a different document.
	 */
	public static function today(): string {
		return function_exists( 'wp_date' ) ? (string) wp_date( 'Y-m-d' ) : gmdate( 'Y-m-d' );
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
