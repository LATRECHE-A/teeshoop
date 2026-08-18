<?php
/**
 * The payment rail, and the alarms around it.
 *
 * WHICH RAIL, AND WHY IT IS NOT OUR CODE. Question 15 is unanswered and its
 * written default is Stripe for card and mobile payment. Constat 6 confirms the
 * shop's own history: the fifteen orders it took between November 2024 and April
 * 2025 were paid by card, Apple Pay and Google Pay, all through Stripe, and the
 * keys have since been removed. So the rail is settled by the default and by
 * what the shop already did.
 *
 * The integration is the maintained one from wordpress.org, authored by Stripe
 * itself, GPLv3, no licence key. Writing our own was considered and refused, and
 * the reason is worth recording because it is the opposite of the usual
 * not-invented-here argument: a correct SCA integration is PaymentIntents plus a
 * five-state machine plus `next_action` per method plus signed, idempotent,
 * out-of-order webhooks plus asynchronous methods that stay pending for days.
 * The maintained plugin is 59 024 lines of PHP handling 24 webhook event types,
 * and its recent changelog is a list of races found in production by 700 000
 * shops, including a 3-D Secure and webhook double-completion. We would ship
 * every one of those and find them one customer at a time.
 *
 * AND IT BUYS US NOTHING WE NEED. The price authority is `Pricing.php`; every
 * gateway charges `$order->get_total()`, which WooCommerce computed from line
 * items we set. The gateway never sees a price we did not write. What a custom
 * gateway would have added is one invariant, that the amount confirmed equals
 * our own recomputed total, and `Checkout::assert_total` has that without any of
 * the surface.
 *
 * SO NOTHING HERE IS ABOUT ANY PARTICULAR PROVIDER. This file watches the
 * gateway layer generically: is anything able to take money, is it pointed at a
 * test account, and is the shop about to hand a customer a free order. The one
 * provider-specific fact, how a given gateway spells "test mode", is a table of
 * conventions at the bottom, because WooCommerce has no API for it and every
 * gateway invents its own.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Payment {

	/** A real account will be charged. */
	public const LIVE = 'live';

	/** A sandbox will be charged, so nothing reaches the bank. */
	public const TEST = 'test';

	/** The gateway is enabled and has no credentials at all. */
	public const UNCONFIGURED = 'unconfigured';

	/** We could not tell, which is not the same as either of the above. */
	public const UNKNOWN = 'unknown';

	public static function init(): void {
		add_filter( 'woocommerce_get_bacs_locale', array( self::class, 'bacs_locale_fr' ) );
		add_action( 'admin_notices', array( self::class, 'notice' ) );
	}

	/**
	 * Every enabled gateway, and which account it would charge.
	 *
	 * @return array<string,array{title:string,environment:string}>
	 */
	public static function enabled(): array {
		if ( ! function_exists( 'WC' ) || ! WC()->payment_gateways() ) {
			return array();
		}

		$out = array();
		foreach ( WC()->payment_gateways()->get_available_payment_gateways() as $id => $gateway ) {
			$out[ (string) $id ] = array(
				'title'       => (string) $gateway->get_title(),
				'environment' => self::environment_of( $gateway ),
			);
		}
		return $out;
	}

	/**
	 * Which account a gateway would actually charge.
	 *
	 * THE FLAG IS NOT THE ANSWER, and this is measured rather than defensive.
	 * On 18/08/2026, against a freshly activated and never-saved Stripe gateway
	 * on the local mirror, `WC_Settings_API::get_option('testmode')` returned
	 * 'yes' while the plugin's own `WC_Stripe_Mode::is_test()` returned false:
	 * the settings screen shows test mode ticked and the mode API reports live,
	 * because one reader merges the form-field default and the other hard-codes
	 * a different fallback. That is two implementations of one rule, in a
	 * dependency, and an alarm built on either of them would be wrong half the
	 * time.
	 *
	 * A SECRET KEY CANNOT DISAGREE WITH ITSELF. Where a gateway's credentials
	 * are self-describing, the prefix is read instead, and it is the prefix of
	 * the key the gateway says it will use. Everything else falls back to the
	 * conventional flags, and a gateway that answers none of them returns
	 * `unknown` rather than being assumed safe.
	 */
	public static function environment_of( \WC_Payment_Gateway $gateway ): string {
		$keyed = self::keyed_environment( (string) $gateway->id );
		if ( self::UNKNOWN !== $keyed ) {
			return $keyed;
		}

		foreach ( array( 'testmode', 'sandbox', 'test_mode' ) as $flag ) {
			$value = $gateway->get_option( $flag, null );
			if ( null === $value || '' === $value ) {
				continue;
			}
			return in_array( $value, array( 'yes', '1', 1, true ), true ) ? self::TEST : self::LIVE;
		}

		/*
		 * The core offline gateways take no money at all: no account is charged,
		 * so neither answer applies and pretending one does would put a false
		 * alarm on a correctly configured shop.
		 */
		if ( in_array( $gateway->id, array( 'bacs', 'cheque', 'cod' ), true ) ) {
			return self::LIVE;
		}

		return self::UNKNOWN;
	}

	/**
	 * Gateways whose credentials say which account they belong to.
	 *
	 * A table and not a branch: WooCommerce has no core notion of test mode, so
	 * this is per-provider knowledge, and it is data so that the rest of the file
	 * stays about gateways in general. One row today.
	 *
	 * `option` is where the gateway keeps its settings array, `live` and `test`
	 * are the keys of the secret it would send, and `test_pattern` is what a
	 * sandbox secret looks like.
	 */
	private static function keyed_environment( string $gateway_id ): string {
		$conventions = array(
			'stripe' => array(
				'option'       => 'woocommerce_stripe_settings',
				'flag'         => 'testmode',
				'live'         => 'secret_key',
				'test'         => 'test_secret_key',
				'test_pattern' => '/^[rs]k_test_/',
			),
		);

		if ( ! isset( $conventions[ $gateway_id ] ) ) {
			return self::UNKNOWN;
		}
		$rule = $conventions[ $gateway_id ];

		$settings = get_option( $rule['option'], array() );
		if ( ! is_array( $settings ) ) {
			$settings = array();
		}

		$in_test = 'yes' === ( $settings[ $rule['flag'] ] ?? 'no' );
		$key     = (string) ( $settings[ $in_test ? $rule['test'] : $rule['live'] ] ?? '' );

		if ( '' === $key ) {
			// "We could not look" is not "it is live".
			return self::UNCONFIGURED;
		}
		return 1 === preg_match( $rule['test_pattern'], $key ) ? self::TEST : self::LIVE;
	}

	/**
	 * What is wrong with the payment configuration, in French, for the operator.
	 *
	 * @return string[]
	 */
	public static function problems(): array {
		$problems = array();
		$gateways = self::enabled();

		if ( empty( $gateways ) ) {
			$problems[] = __( 'Aucun moyen de paiement n’est actif : la boutique ne peut rien encaisser. Activez une passerelle dans WooCommerce, Réglages, Paiements.', 'teeshoop' );
			return $problems;
		}

		foreach ( $gateways as $id => $gateway ) {
			if ( self::TEST === $gateway['environment'] ) {
				$problems[] = sprintf(
					/* translators: %s: the name of a payment method. */
					__( '« %s » est branché sur un compte de test : les paiements sont simulés et rien n’arrive sur le compte bancaire.', 'teeshoop' ),
					$gateway['title']
				);
			}
			if ( self::UNCONFIGURED === $gateway['environment'] ) {
				$problems[] = sprintf(
					/* translators: %s: the name of a payment method. */
					__( '« %s » est activé sans aucune clé : il est proposé au client et ne peut rien encaisser.', 'teeshoop' ),
					$gateway['title']
				);
			}
			if ( self::UNKNOWN === $gateway['environment'] ) {
				$problems[] = sprintf(
					/* translators: %s: the name of a payment method. */
					__( '« %s » ne dit pas s’il est en test ou en réel. Vérifiez-le chez le prestataire avant la mise en ligne.', 'teeshoop' ),
					$gateway['title']
				);
			}
		}

		return $problems;
	}

	/**
	 * Whether a real account would be charged, for the launch gate of session 13b.
	 *
	 * True only when at least one gateway is live and none is in test. A shop
	 * that offers both a live card and a sandbox wallet is not ready, and which
	 * of the two a given customer picks is not something we get to hope about.
	 */
	public static function ready(): bool {
		$gateways = self::enabled();
		if ( empty( $gateways ) ) {
			return false;
		}
		foreach ( $gateways as $gateway ) {
			if ( self::LIVE !== $gateway['environment'] ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Name the bank-transfer fields the way a French holder reads them.
	 *
	 * WooCommerce relabels the BACS account table for AU, CA, IN, IT, NZ, SE, US
	 * and ZA, and has no FR entry, so a French customer is shown a column headed
	 * "Sort code", a British concept with no French equivalent, next to
	 * "Account number", which means nothing beside an IBAN. Read in
	 * `WC_Gateway_BACS::get_country_locale()` on WooCommerce 11.0.1.
	 *
	 * Virement itself is not enabled by default: question 15's written default
	 * accepts it "sur devis", so it belongs to the quote path of session 06 and
	 * not to a self-serve basket. This only makes sure that the day it is turned
	 * on, it is not nonsense.
	 */
	public static function bacs_locale_fr( array $locale ): array {
		$locale['FR'] = array(
			'sortcode' => array( 'label' => __( 'Code guichet', 'teeshoop' ) ),
		);
		return $locale;
	}

	/** Say it where the person who can fix it will read it. */
	public static function notice(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$problems = self::problems();
		if ( empty( $problems ) ) {
			return;
		}

		/*
		 * Everywhere in the admin, not only on the payment screens. A shop that
		 * cannot be paid is not a settings detail, and the person who needs to
		 * know is not on their way to Réglages, Paiements when it matters.
		 */
		echo '<div class="notice notice-warning"><p><strong>Teeshoop</strong> : ';
		esc_html_e( 'la configuration des paiements demande une vérification.', 'teeshoop' );
		echo '</p><ul style="list-style:disc;margin-left:1.5em">';
		foreach ( $problems as $problem ) {
			echo '<li>' . esc_html( $problem ) . '</li>';
		}
		echo '</ul></div>';
	}
}
