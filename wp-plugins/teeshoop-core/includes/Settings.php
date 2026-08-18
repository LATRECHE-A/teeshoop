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
			/*
			 * Which of the two bases leads on a page, and the answer to question
			 * 01's display half.
			 *
			 * `ht_first` because that question's written default is a shop
			 * reserved for professionals, "prix affichés hors taxes avec le
			 * montant toutes taxes comprises en second". If the answer comes
			 * back "particuliers aussi", French consumer law requires the TTC to
			 * lead, and flipping this setting is the whole change: nothing is
			 * STORED in the other basis, every amount in this plugin is HT in
			 * integer cents, so there is nothing to migrate.
			 */
			'price_display'      => 'ht_first',
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
	 * How a page should print a price: whether there are two bases at all, and
	 * which one leads.
	 *
	 * ONE DECISION, THREE TEMPLATES. Under the franchise there is no VAT, so a
	 * page that prints "14,50 EUR HT (14,50 EUR TTC)" states the same number
	 * twice and invites the reader to look for a tax line that must not exist.
	 * Under the standard regime both bases are printed, and which leads is a
	 * setting. Deciding that in each template would be three copies of one rule.
	 *
	 * @return array{two:bool,lead:string,mention:string}
	 */
	public static function price_bases(): array {
		$vat = self::vat();

		/*
		 * AN UNKNOWN REGIME IS NOT THE FRANCHISE, and reading it as one put the
		 * franchise's own sentence in front of every visitor: `rate` is 0,0 when
		 * no period covers today, so the grid announced "aucune taxe ne s'y
		 * ajoute" on a shop that had simply not been told what it was. That is a
		 * statement about the seller's tax position, made to a customer, on no
		 * evidence at all.
		 *
		 * With `known` false the page prints one number and says nothing about
		 * tax, which is the truth. The basket refuses the sale anyway, so nobody
		 * can act on it.
		 */
		return array(
			'known'   => (bool) $vat['known'],
			'two'     => $vat['known'] && (float) $vat['rate'] > 0,
			'lead'    => 'ttc_first' === self::get( 'price_display' ) ? 'ttc' : 'ht',
			'mention' => $vat['known'] ? (string) $vat['mention'] : '',
		);
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
