<?php
/**
 * Money, in integer cents.
 *
 * Floats are not allowed to hold a price anywhere in this plugin. `0.1 + 0.2`
 * is not `0.3`, and a boutique that adds a per-side surcharge to a discounted
 * unit price and multiplies by 47 will drift by a cent or two, which then
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
	 * function means every rounding site in the plugin is greppable, and the
	 * day someone needs banker's rounding for an accountant, there is exactly
	 * one place to change.
	 */
	public static function round( float $cents ): int {
		return (int) round( $cents, 0, PHP_ROUND_HALF_UP );
	}

	/**
	 * Euros as written by a human, or NULL when the field holds no number.
	 *
	 * Accepts "14,50" as well as "14.50": the shop is French, the admin will
	 * type a comma, and silently reading "14,50" as 14 would under-price every
	 * garment by a third without anything looking wrong. It also accepts the
	 * unit typed back into the field, "14,50 €" and "55 %", because the admin
	 * screens print that sign as a label right beside the input and that is
	 * exactly what invites retyping it.
	 *
	 * NULL AND NOT ZERO, and that is the whole reason this exists beside
	 * `from_eur`. A field that cannot be read and a field holding zero are
	 * different answers: measured on the cost screen, "25 %" read as 0,00 took
	 * the floor price of the Bible's own 250,00 EUR example from 428,57 EUR to
	 * 250,00 EUR, and an order at 260,00 EUR went from needing a derogation to
	 * reading "vendable sans validation". A caller that has a sensible fallback
	 * uses this; a caller reading a machine-written number uses `from_eur`.
	 */
	public static function parse_eur( string|float|int $eur ): ?int {
		if ( is_string( $eur ) ) {
			$text = str_replace( array( ' ', "\u{00A0}", "\u{202F}", '%', '€' ), '', trim( $eur ) );
			$text = str_replace( ',', '.', $text );
			if ( '' === $text || ! is_numeric( $text ) ) {
				return null;
			}
			$eur = (float) $text;
		}
		if ( ! is_finite( (float) $eur ) ) {
			return null;
		}
		return self::round( (float) $eur * 100 );
	}

	/**
	 * The same, reading anything unparseable as zero.
	 *
	 * Kept because most callers hand it a number WooCommerce wrote, where zero
	 * is the right answer to "this order has no tax" and there is nothing for a
	 * human to have mistyped.
	 */
	public static function from_eur( string|float|int $eur ): int {
		return self::parse_eur( $eur ) ?? 0;
	}

	/** Cents to a float of euros, for JSON output and WooCommerce, never for arithmetic. */
	public static function to_eur( int $cents ): float {
		return $cents / 100;
	}

	/** "1 234,56 €", French formatting, narrow no-break space before the sign. */
	public static function format( int $cents ): string {
		return self::number( self::to_eur( $cents ), 2 ) . "\u{202F}€";
	}

	/**
	 * Any other number a French customer reads: a quantity, an area, a count.
	 *
	 * NOT `number_format_i18n`, which takes its separators from the WordPress
	 * locale. A stock WordPress is en_US, and it renders 1250 as "1,250": to a
	 * French reader that is one and a quarter. The page published
	 * "jusqu'à 1,250 cm²" as the surcharge threshold, which reads as a 1,25 cm²
	 * ceiling, so every real print appeared to be over it. Measured on the
	 * mirror, whose locale is en_US, on 2026-08-14.
	 *
	 * The separators are therefore fixed here rather than inherited, exactly as
	 * `format()` above already fixes them for money. One shop, one way of
	 * writing a number.
	 */
	public static function number( float $value, int $decimals = 0 ): string {
		return number_format( $value, $decimals, ',', "\u{202F}" );
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
