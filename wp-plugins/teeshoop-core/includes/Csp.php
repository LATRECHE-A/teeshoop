<?php
/**
 * The Content Security Policy the shop sends, and why each source is in it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT SHIPS IN REPORT-ONLY AND THAT IS THE POINT, NOT A HALF MEASURE.
 *
 * A CSP that breaks Stripe fails in production, at the checkout, and nowhere
 * else. This one CANNOT be exercised against a real payment here: the mirror has
 * no Stripe keys (`woocommerce_stripe_settings` is empty, question 15 is
 * unanswered), the gateway therefore enqueues nothing, and `js.stripe.com` does
 * not appear in the checkout markup at all. Measured 28/08/2026.
 *
 * So the header is `Content-Security-Policy-Report-Only` until somebody defines
 * `TEESHOOP_CSP_ENFORCE`, and the runbook says what has to be true first: a card
 * paid end to end with test keys, a 3-D Secure challenge, and the reports read.
 * Report-Only costs nothing and reports everything; enforcing before that trade
 * is made would be trading a customer's payment for a header.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY FROM PHP AND NOT FROM .htaccess
 *
 * An .htaccess policy also covers `/wp-admin`, where this plugin alone prints
 * dozens of inline style attributes and several inline `<style>` blocks, and
 * where core and WooCommerce print far more. Covering it would force
 * `'unsafe-inline'` everywhere, which is most of what a first policy buys.
 *
 * THE COST OF THAT CHOICE, WRITTEN DOWN: a PHP header is not sent on a page
 * served from the LiteSpeed cache without running PHP. On o2switch that is the
 * normal case for an anonymous visitor. So the day page caching is switched on,
 * either the policy moves to .htaccess (and accepts `'unsafe-inline'` for
 * wp-admin) or the cache must be told to store the header with the page.
 * `scripts/csp-verify.mjs` fetches every page twice and reports a header that
 * disappears on the second request, so this cannot go unnoticed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO ORIGINS ARE READ AT EMIT TIME
 *
 * The studio and the Worker are runtime settings with empty defaults, and the
 * mirror uses `http://` while production will use `https://`. A hard-coded host
 * would be a policy that is right in exactly one environment.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Csp {

	/**
	 * Where a violation report is posted, or '' for none.
	 *
	 * Empty by default and deliberately: a report endpoint is a route that
	 * accepts unauthenticated POSTs from every browser on the internet, and this
	 * session is not adding one without deciding what stores it and for how long
	 * (which is a personal-data question, not a security one). Without it the
	 * reports still reach the browser console, which is where
	 * `scripts/csp-verify.mjs` reads them.
	 */
	private const REPORT_URI = '';

	/**
	 * Stripe's own hosts.
	 *
	 * `js.stripe.com` is PROVEN from the gateway's source: version 10.8.5
	 * registers `https://js.stripe.com/clover/stripe.js` in three places
	 * (abstract-wc-stripe-payment-gateway.php:2285,
	 * class-wc-stripe-express-checkout-element.php:426,
	 * class-wc-stripe-upe-payment-gateway.php:469). It is the only external
	 * script the gateway enqueues.
	 *
	 * THE OTHERS ARE NOT PROVEN HERE and are in the list because Stripe.js
	 * contacts them and because Report-Only is what turns that from a guess into
	 * a reading. `api.stripe.com` appears in the gateway's own source;
	 * `m.stripe.network` and `r.stripe.com` do not, because they are contacted by
	 * Stripe's script and not by the plugin, so no amount of reading this
	 * repository would have found them. They are listed, the policy reports
	 * rather than blocks, and the runbook says to read the reports from a real
	 * payment before enforcing. That is the honest order of operations.
	 */
	private const STRIPE_SCRIPT = array( 'https://js.stripe.com' );
	private const STRIPE_FRAME  = array( 'https://js.stripe.com', 'https://hooks.stripe.com' );
	private const STRIPE_CONNECT = array(
		'https://api.stripe.com',
		'https://m.stripe.network',
		'https://r.stripe.com',
	);

	/** One value per request, or '' before `send_headers` has run. */
	private static string $nonce = '';

	public static function init(): void {
		add_action( 'send_headers', array( self::class, 'send' ) );
		/*
		 * The nonce has to reach every script tag WordPress prints, and there are
		 * two kinds. `wp_inline_script_attributes` covers the blobs from
		 * `wp_localize_script` and `wp_add_inline_script`, which is where the
		 * bridge's configuration and WooCommerce's settings live;
		 * `script_loader_tag` covers the `<script src>` tags.
		 *
		 * WHAT THIS DOES NOT COVER, and it is the reason the policy also carries
		 * `'unsafe-inline'` in script-src for now: WooCommerce echoes `wc_no_js`
		 * by hand outside that pipeline, so no filter can nonce it. A browser
		 * that understands nonces ignores `'unsafe-inline'` when a nonce is
		 * present, so the two together are not a contradiction, they are a
		 * fallback for the older browsers that ignore the nonce instead.
		 */
		add_filter( 'wp_inline_script_attributes', array( self::class, 'nonce_attribute' ) );
		add_filter( 'script_loader_tag', array( self::class, 'nonce_tag' ), 10, 1 );

		/*
		 * AND THE ONE INLINE SCRIPT NO FILTER CAN REACH.
		 *
		 * `wc_no_js()` swaps the `woocommerce-no-js` body class for
		 * `woocommerce-js`, and WooCommerce echoes it BY HAND on `wp_footer`
		 * (wc-template-functions.php:389 and :400), outside
		 * `wp_print_inline_script_tag`, so `wp_inline_script_attributes` never sees
		 * it. Measured under the policy: two `script-src-elem` refusals on every
		 * page of the shop, one of them this.
		 *
		 * IT IS NOT COSMETIC. Several WooCommerce styles key off that class, and on
		 * the cart and the checkout it is what tells the page JavaScript is running.
		 * Leaving it refused would be a shop that looks broken to anybody with a
		 * policy enforced.
		 *
		 * So the action is removed and replaced by the same script with a nonce,
		 * byte for byte otherwise. `Compat.php` pins the callback name because that
		 * is the coupling: if WooCommerce renames it, `remove_action` silently does
		 * nothing and the page grows a second copy. The replacement is registered at
		 * a priority that keeps the original ordering.
		 */
		add_action( 'wp_footer', array( self::class, 'replace_wc_no_js' ), 0 );
	}

	/** See `init()`. Runs before WooCommerce's own callback at the default priority. */
	public static function replace_wc_no_js(): void {
		if ( is_admin() || ! has_action( 'wp_footer', 'wc_no_js' ) ) {
			return;
		}
		remove_action( 'wp_footer', 'wc_no_js' );
		add_action(
			'wp_footer',
			static function (): void {
				printf(
					'<script nonce="%s">(function () { var c = document.body.className; c = c.replace(/woocommerce-no-js/, \'woocommerce-js\'); document.body.className = c; })();</script>',
					esc_attr( self::nonce() )
				);
			}
		);
	}

	/** The per-request nonce, minted on first use. */
	public static function nonce(): string {
		if ( '' === self::$nonce ) {
			self::$nonce = base64_encode( random_bytes( 16 ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
		}
		return self::$nonce;
	}

	/** @param array<string,mixed> $attributes */
	public static function nonce_attribute( array $attributes ): array {
		if ( ! is_admin() ) {
			$attributes['nonce'] = self::nonce();
		}
		return $attributes;
	}

	public static function nonce_tag( string $tag ): string {
		if ( is_admin() || false === strpos( $tag, '<script' ) || false !== strpos( $tag, ' nonce=' ) ) {
			return $tag;
		}
		return (string) preg_replace( '/<script(?=[\s>])/', '<script nonce="' . esc_attr( self::nonce() ) . '"', $tag, 1 );
	}

	/**
	 * The header, built from what this installation actually points at.
	 *
	 * Front end only: `is_admin()` is the whole reason this is not in .htaccess.
	 */
	public static function send(): void {
		if ( is_admin() || headers_sent() ) {
			return;
		}
		$header = defined( 'TEESHOOP_CSP_ENFORCE' ) && TEESHOOP_CSP_ENFORCE
			? 'Content-Security-Policy'
			: 'Content-Security-Policy-Report-Only';
		header( $header . ': ' . self::policy(), true );

		/*
		 * The three that cost nothing and are not a policy.
		 *
		 * `nosniff` stops a browser deciding a stored file is HTML.
		 * `Referrer-Policy` keeps a full URL off third-party servers, which
		 * matters because a proof URL is a capability (Bat.php already sets
		 * `no-referrer` on the proof page itself; this is the site-wide floor).
		 * `X-Frame-Options` is deliberately ABSENT: `frame-ancestors` below says
		 * the same thing and says it better, and an XFO value is a blunt
		 * instrument with no working cross-origin form.
		 */
		header( 'X-Content-Type-Options: nosniff', true );
		header( 'Referrer-Policy: strict-origin-when-cross-origin', true );
	}

	/** The policy string, so a test can read it without sending a header. */
	public static function policy(): string {
		$studio = Settings::studio_origin();
		$worker = self::origin_of( (string) Settings::get( 'worker_url' ) );
		$nonce  = "'nonce-" . self::nonce() . "'";

		$img     = array_filter( array( "'self'", 'data:', 'blob:', $worker ) );
		$connect = array_merge( array_filter( array( "'self'", $worker ) ), self::STRIPE_CONNECT );
		$frame   = array_merge( array_filter( array( $studio ) ), self::STRIPE_FRAME );
		$script  = array_merge( array( "'self'", $nonce, "'unsafe-inline'" ), self::STRIPE_SCRIPT );

		$directives = array(
			// Not 'none'. WordPress core, WooCommerce and the Stripe gateway are
			// not in this repository, so their full destination list cannot be
			// enumerated from evidence. 'self' is the strongest bound that is
			// still honest, and it covers media-src, manifest-src and worker-src.
			'default-src' => array( "'self'" ),
			'script-src'  => $script,
			// 'unsafe-inline' AND IT WILL NOT LEAVE. WP_Styles builds inline
			// <style> tags by hand and there is no attribute filter for them, and
			// the 442 measured colour swatches ride on style="" attributes in
			// facet-couleur.php and the product specification table. A nonce
			// cannot reach either. This directive is the honest limit of a
			// first policy, written here rather than quietly omitted.
			'style-src'   => array( "'self'", "'unsafe-inline'" ),
			'img-src'     => $img,
			'font-src'    => array( "'self'" ),
			'connect-src' => $connect,
			'frame-src'   => $frame,
			// Nobody may frame the shop. The shop frames the studio, not the
			// other way round, and this is what an X-Frame-Options header would
			// have said less precisely.
			'frame-ancestors' => array( "'none'" ),
			'form-action'     => array( "'self'" ),
			'base-uri'        => array( "'self'" ),
			'object-src'      => array( "'none'" ),
			// No inline event handlers anywhere in this theme or plugin, checked.
			// Core and WooCommerce were not checked, which is another thing
			// Report-Only is for.
			'script-src-attr' => array( "'none'" ),
		);

		/*
		 * `upgrade-insecure-requests` ONLY on an https site. The mirror is http
		 * and its Worker is http, so adding it unconditionally would upgrade
		 * every local request to a port nothing listens on and break development
		 * while production stayed green: the worst shape a bug can have.
		 */
		if ( is_ssl() ) {
			$directives['upgrade-insecure-requests'] = array();
		}

		$out = array();
		foreach ( $directives as $name => $sources ) {
			$out[] = empty( $sources ) ? $name : $name . ' ' . implode( ' ', array_unique( $sources ) );
		}
		if ( '' !== self::REPORT_URI ) {
			$out[] = 'report-uri ' . self::REPORT_URI;
		}
		return implode( '; ', $out );
	}

	/** scheme://host[:port] of a configured URL, or '' when there is not one. */
	private static function origin_of( string $url ): string {
		if ( '' === $url ) {
			return '';
		}
		$p = wp_parse_url( $url );
		if ( empty( $p['scheme'] ) || empty( $p['host'] ) ) {
			return '';
		}
		$origin = strtolower( $p['scheme'] ) . '://' . strtolower( $p['host'] );
		if ( ! empty( $p['port'] ) ) {
			$origin .= ':' . (int) $p['port'];
		}
		return $origin;
	}
}
