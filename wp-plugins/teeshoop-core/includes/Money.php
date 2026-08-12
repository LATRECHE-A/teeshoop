<?php
/**
 * Money, in integer cents.
 *
 * Floats are not allowed to hold a price anywhere in this plugin. `0.1 + 0.2`
 * is not `0.3`, and a boutique that adds a per-side surcharge to a discounted
 * unit price and multiplies by 47 will drift by a cent or two — which then
 * disagrees with WooCommerce's own total, with the invoice, and with the
 * payment processor. Cents are exact, and the only rounding is the one we ask
 * for, where we ask for it.
 *
 * Everything here is HT (excl. VAT) unless the name says otherwise. See
 * Vat.php for the one place the two bases meet.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Money {

	/**
	 * Round to whole cents, half away from zero.
	 *
	 * PHP's round() already does half-away-from-zero, but going through this
	 * function means every rounding site in the plugin is greppable — and the
	 * day someone needs banker's rounding for an accountant, there is exactly
	 * one place to change.
	 */
	public static function round( float $cents ): int {
		return (int) round( $cents, 0, PHP_ROUND_HALF_UP );
	}

	/**
	 * Euros (as written by a human in an admin field) to cents.
	 *
	 * Accepts "14,50" as well as "14.50": the shop is French, the admin will
	 * type a comma, and silently reading "14,50" as 14 would under-price every
	 * garment by a third without anything looking wrong.
	 */
	public static function from_eur( string|float|int $eur ): int {
		if ( is_string( $eur ) ) {
			$eur = str_replace( array( ' ', "\u{00A0}", "\u{202F}" ), '', $eur );
			$eur = str_replace( ',', '.', $eur );
			if ( ! is_numeric( $eur ) ) {
				return 0;
			}
		}
		return self::round( (float) $eur * 100 );
	}

	/** Cents to a float of euros — for JSON output and WooCommerce, never for arithmetic. */
	public static function to_eur( int $cents ): float {
		return $cents / 100;
	}

	/** "1 234,56 €" — French formatting, narrow no-break space before the sign. */
	public static function format( int $cents ): string {
		return number_format( self::to_eur( $cents ), 2, ',', "\u{202F}" ) . "\u{202F}€";
	}

	/**
	 * Apply a rate (0.0–1.0) to an amount, rounding once.
	 *
	 * `pct( $c, 0.15 )` is the discount, not the discounted price.
	 */
	public static function pct( int $cents, float $rate ): int {
		return self::round( $cents * $rate );
	}
}
