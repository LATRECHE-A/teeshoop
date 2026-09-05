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
 * ── AND SINCE 5 SEPTEMBER 2026 IT ALSO HOLDS THE DOOR ───────────────────────
 *
 * Watching was all it did. `Launch`'s money door refused on sixteen counts and
 * an operator could still switch a gateway on in wp-admin, because the gate
 * blocked a FILE COPY in a deploy script and nothing inside WordPress had ever
 * heard of it. Three places now read it, and they cover different paths on
 * purpose:
 *
 *   hold_gateways()     removes every gateway from the customer's checkout.
 *                       The backstop: it holds even for a gateway that decided
 *                       it was enabled without writing to its settings option.
 *   refuse_enabling()   refuses the WRITE that turns a gateway on. Covers the
 *                       toggle on the payments list (AJAX), a gateway's own
 *                       settings screen, and anything else calling
 *                       `WC_Settings_API::update_option()`, because WooCommerce
 *                       11.0.1 funnels all of them through one filter.
 *   refuse_toggle()     answers the payments-list toggle before WooCommerce
 *                       does, so the control snaps back instead of hanging.
 *
 * WHAT IS NOT COVERED, said plainly, because a guard whose holes are undocumented
 * is a guard somebody over-trusts:
 *
 *   - a write to a gateway's settings before anything asked WooCommerce for its
 *     gateway list, since the per-option filters are registered from that list;
 *   - a call to `add_option()` directly on an option that does not exist yet,
 *     which fires `pre_add_option_{$option}` and not the update filter. The
 *     WooCommerce path itself is safe here: read in wp-includes/option.php,
 *     `update_option()` applies `pre_update_option_{$option}` BEFORE deciding to
 *     fall back to `add_option()`, so a never-saved gateway is still caught.
 *
 * Both holes leave a gateway that is enabled in the database and that
 * `hold_gateways()` then keeps out of the checkout. That is why the backstop
 * exists and is not redundant with the guard.
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

	/** Where a refused activation leaves its reasons for the next page load. */
	private const TRANSIENT_REFUS = 'teeshoop_paiement_refuse';

	/**
	 * True while this class is READING the shop rather than serving a customer.
	 *
	 * `enabled()` asks WooCommerce which gateways it would offer, and that
	 * question re-enters `hold_gateways()`, which would answer with our own
	 * refusal. Two things would then be wrong at once: the recursion, and the
	 * meaning. A shop held by the money door would report every gateway as
	 * "enabled and not offered to the customer", which is this file's sentence
	 * for MISSING CREDENTIALS, and the operator would be sent hunting for keys
	 * that are already in place.
	 */
	private static bool $inspecting = false;

	/**
	 * The list the customer is about to be offered, when we are inside the door.
	 *
	 * `hold_gateways()` receives it as its argument, so asking WooCommerce for
	 * it again would run every gateway's `is_available()` a second time on every
	 * cart page. Handing it down instead is both cheaper and more exact: the
	 * door then judges the very list it is about to hold.
	 *
	 * @var array<int,string>|null
	 */
	private static ?array $offered = null;

	public static function init(): void {
		add_filter( 'woocommerce_get_bacs_locale', array( self::class, 'bacs_locale_fr' ) );
		add_action( 'admin_notices', array( self::class, 'notice' ) );

		/*
		 * LAST WORD, deliberately. Anything that adds a gateway back after this
		 * would be putting a till in front of a customer the money door has
		 * refused, and there is no case where that is what we meant.
		 */
		add_filter( 'woocommerce_available_payment_gateways', array( self::class, 'hold_gateways' ), PHP_INT_MAX );
		// Le client doit lire que rien ne sera prélevé, là où il s'apprête à
		// payer. Les deux crochets, parce que le panier et la caisse sont deux
		// pages et qu'un client peut arriver directement sur la seconde.
		add_action( 'woocommerce_before_cart', array( self::class, 'notice_test_mode' ) );
		add_action( 'woocommerce_before_checkout_form', array( self::class, 'notice_test_mode' ) );

		/*
		 * Registered from the gateway list itself, the way WooCommerce core
		 * registers its own per-gateway option hooks in
		 * `WC_Payment_Gateways::on_payment_gateways_initialized()`. That is what
		 * makes the option names exact rather than a pattern: shipping methods
		 * are `WC_Settings_API` subclasses too and their options look identical,
		 * and refusing to turn on a shipping method because a product has no
		 * blank would be nonsense.
		 */
		add_action( 'wc_payment_gateways_initialized', array( self::class, 'guard_gateway_options' ) );

		// Before WooCommerce's own handler, which registers at priority 10.
		add_action( 'wp_ajax_woocommerce_toggle_gateway_enabled', array( self::class, 'refuse_toggle' ), 1 );

		add_action( 'admin_notices', array( self::class, 'gate_notice' ) );

		/*
		 * ET CE QUE LE CLIENT LIT QUAND LA CAISSE EST TENUE. Retirer les moyens
		 * de paiement laissait la phrase de WooCommerce, qui parle d'une
		 * indisponibilité liée au pays et invite à « nous contacter pour prendre
		 * d'autres dispositions ». C'est faux et ça envoie un message.
		 */
		add_filter( 'woocommerce_no_available_payment_methods_message', array( self::class, 'no_methods_message' ) );
	}

	/**
	 * What the customer reads at the checkout when nothing can take their money.
	 *
	 * NO REASON IS GIVEN, and that is deliberate: the money door refuses over
	 * our supplier references and our cost floors, which are our business and not
	 * the customer's. What they need is the true state and a way forward, and the
	 * quote path is a real one on this shop.
	 *
	 * WHICH CHECKOUT THIS COVERS, honestly. `templates/checkout/payment.php` and
	 * `templates/checkout/form-pay.php` on WooCommerce 11.0.1, that is the
	 * classic checkout and the pay-for-an-order page. The BLOCK checkout builds
	 * its own string in JavaScript from the Store API and does not read this
	 * filter; the mirror runs the block checkout, so this sentence is not what a
	 * customer sees there yet. Said here rather than left to be discovered.
	 *
	 * @param mixed $message WooCommerce's own sentence.
	 */
	public static function no_methods_message( $message ): string {
		if ( ! class_exists( __NAMESPACE__ . '\\Launch' ) || ! Launch::money_refuses() ) {
			return (string) $message;
		}
		return __( 'Le paiement en ligne est fermé pour le moment, donc cette commande ne peut pas être réglée ici. Votre panier est conservé. Pour être livré malgré tout, demandez un devis : nous vous répondons sous un jour ouvré avec le prix et le délai.', 'teeshoop' );
	}

	/**
	 * Every gateway the shop has TURNED ON, which account it would charge, and
	 * whether a customer can actually reach it.
	 *
	 * NOT `get_available_payment_gateways()`, and that distinction is the whole
	 * alarm. That list holds only the gateways whose `is_available()` says yes,
	 * which is the customer's view, so a payment method switched ON and unable
	 * to take a cent is exactly the case it cannot show. Measured on the mirror
	 * on 18/08/2026 against a real gateway turned on and removed from the
	 * available list: the first version of this function reported a clean shop
	 * with zero problems.
	 *
	 * So the enumeration starts from every registered gateway, keeps the ones
	 * whose `enabled` setting says yes, and records separately whether the
	 * customer would be offered it. "Turned on" and "usable" are different
	 * facts, and conflating them is the same mistake as conflating "no" with
	 * "could not look".
	 *
	 * @return array<string,array{title:string,environment:string,offered:bool}>
	 */
	public static function enabled(): array {
		if ( ! function_exists( 'WC' ) || ! WC()->payment_gateways() ) {
			return array();
		}

		/*
		 * The list the door already holds, when there is one. See $offered and
		 * $inspecting above: both exist so that this reading of the shop never
		 * observes the door's own refusal and reports it as a misconfiguration.
		 */
		if ( null !== self::$offered ) {
			$available = self::$offered;
		} else {
			self::$inspecting = true;
			try {
				$available = array_keys( WC()->payment_gateways()->get_available_payment_gateways() );
			} finally {
				self::$inspecting = false;
			}
		}

		$out = array();
		foreach ( WC()->payment_gateways()->payment_gateways() as $gateway ) {
			if ( ! $gateway instanceof \WC_Payment_Gateway || 'yes' !== $gateway->enabled ) {
				continue;
			}
			$out[ (string) $gateway->id ] = array(
				'title'       => (string) $gateway->get_method_title(),
				'environment' => self::environment_of( $gateway ),
				'offered'     => in_array( (string) $gateway->id, $available, true ),
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
		return array_map(
			static fn( array $p ): string => $p['texte'],
			self::problems_detailed()
		);
	}

	/**
	 * Ce que la PORTE ARGENT refuse, et rien d'autre.
	 *
	 * POURQUOI CETTE SÉPARATION EXISTE, ET C'EST UN DÉFAUT MESURÉ, PAS UNE
	 * PRÉCAUTION. `problems()` décrit la boutique à un exploitant, et il y
	 * compte « activé mais non proposé au client ». Depuis que la porte argent
	 * est appliquée dans WooCommerce, cette phrase retirait TOUTES les
	 * passerelles du paiement, y compris la carte.
	 *
	 * Or « non proposé » est un fait NORMAL ET PAR PANIER, lu dans le code
	 * installé : `WC_Gateway_COD::is_available()` rend false quand le mode de
	 * livraison choisi n'est pas dans `enable_for_methods` ; un moyen Stripe
	 * rend false sous le montant minimum d'un Klarna ou d'un Afterpay ; et
	 * `get_available_payment_gateways()` exclut d'office les passerelles sans
	 * tokenisation sur l'écran « ajouter un moyen de paiement ». Scénario
	 * reproduit : boutique saine, carte en règle, l'exploitant ajoute Klarna, un
	 * client met 24,00 EUR au panier, sous le minimum Klarna. La caisse se
	 * fermait entièrement, et le client lisait que le paiement était fermé.
	 *
	 * CE QUE LA SÉPARATION ACHÈTE EN PLUS. La porte devient une fonction de la
	 * CONFIGURATION seule, jamais du panier. C'est ce qui rend la mémoïsation de
	 * `Launch::money_hold()` correcte : elle figeait auparavant une ENTRÉE
	 * variable, donc la première liste partielle vue dans la requête (panier
	 * vide, écran des moyens enregistrés) fermait la caisse pour tout le reste
	 * de la requête. Sans entrée variable, il n'y a plus rien à figer de faux.
	 *
	 * CE QUE ÇA COÛTE, ET C'EST ÉCRIT PLUTÔT QUE CACHÉ : une passerelle dont les
	 * clés sont valides mais qui n'est jamais proposée pour une autre raison
	 * n'est plus refusée par la porte. Elle reste signalée à l'exploitant par
	 * `problems()`, dans l'écran d'administration et dans la dette de lancement.
	 *
	 * @return array<int,array{texte:string,bloquant:bool}>
	 */
	public static function gate_problems(): array {
		return array_values( array_filter(
			self::problems_detailed(),
			static fn( array $p ): bool => $p['bloquant']
		) );
	}

	/**
	 * Chaque problème, avec le fait de savoir s'il ferme la caisse.
	 *
	 * @return array<int,array{texte:string,bloquant:bool}>
	 */
	public static function problems_detailed(): array {
		$problems = array();
		$gateways = self::enabled();

		$bloquant = static fn( string $t ): array => array( 'texte' => $t, 'bloquant' => true );
		$signale  = static fn( string $t ): array => array( 'texte' => $t, 'bloquant' => false );

		if ( empty( $gateways ) ) {
			// AUCUNE PASSERELLE ACTIVE est une propriété de la configuration, pas
			// du panier : elle bloque, et c'est le seul cas « rien à encaisser »
			// qu'on puisse affirmer sans regarder un panier.
			$problems[] = $bloquant( __( 'Aucun moyen de paiement n’est actif : la boutique ne peut rien encaisser. Activez une passerelle dans WooCommerce, Réglages, Paiements.', 'teeshoop' ) );
			return $problems;
		}

		$offered = array_filter( $gateways, static fn( array $g ): bool => $g['offered'] );
		if ( empty( $offered ) ) {
			$problems[] = $signale( __( 'Des moyens de paiement sont activés et aucun n’est proposé pour ce panier. C’est normal pour un panier vide ou sous le montant minimum d’un paiement en plusieurs fois ; si cela vaut pour tous les paniers, il manque en général des clés.', 'teeshoop' ) );
		}

		$essai = self::test_mode_assumed();

		foreach ( $gateways as $id => $gateway ) {
			if ( ! $gateway['offered'] ) {
				$problems[] = $signale( sprintf(
					/* translators: %s: the name of a payment method. */
					__( '« %s » est activé et n’apparaît pas pour ce panier. Vérifiez ses conditions (montant minimum, mode de livraison) ou ses clés.', 'teeshoop' ),
					$gateway['title']
				) );
				continue;
			}
			if ( self::TEST === $gateway['environment'] ) {
				// LE MODE D'ESSAI ASSUMÉ NE BLOQUE PLUS, ET IL SE VOIT. Voir
				// test_mode_assumed() : ce n'est pas une dérogation silencieuse,
				// c'est un réglage que quelqu'un a posé et que le client lit.
				$problems[] = ( $essai ? $signale : $bloquant )( sprintf(
					/* translators: %s: the name of a payment method. */
					__( '« %s » est branché sur un compte de test : les paiements sont simulés et rien n’arrive sur le compte bancaire.', 'teeshoop' ),
					$gateway['title']
				) );
			}
			if ( self::UNCONFIGURED === $gateway['environment'] ) {
				$problems[] = $bloquant( sprintf(
					/* translators: %s: the name of a payment method. */
					__( '« %s » est activé sans aucune clé : il est proposé au client et ne peut rien encaisser.', 'teeshoop' ),
					$gateway['title']
				) );
			}
			if ( self::UNKNOWN === $gateway['environment'] ) {
				$problems[] = $bloquant( sprintf(
					/* translators: %s: the name of a payment method. */
					__( '« %s » ne dit pas s’il est en test ou en réel. Vérifiez-le chez le prestataire avant la mise en ligne.', 'teeshoop' ),
					$gateway['title']
				) );
			}
		}

		return $problems;
	}

	/** Le réglage qui assume le mode d'essai. Voir test_mode_assumed(). */
	public const OPTION_ESSAI = 'teeshoop_paiement_mode_essai';

	/**
	 * La boutique encaisse-t-elle DÉLIBÉRÉMENT en mode d'essai.
	 *
	 * Posé le 5 septembre 2026 sur décision du développeur : la boutique part en
	 * ligne avec des clés Stripe de TEST, parce que le compte n'est pas encore
	 * activé en mode réel. Ce n'est pas une dérogation cachée, et les trois
	 * propriétés qui suivent sont ce qui le distingue d'une :
	 *
	 *   - il faut poser le réglage à la main, il ne vaut jamais oui par défaut ;
	 *   - le client le LIT, au panier et à la caisse (voir notice_test_mode) ;
	 *   - il reste un problème dans `problems()`, donc il reste écrit dans la
	 *     dette de lancement et dans l'écran d'administration tous les jours.
	 *
	 * Ce qu'il ne fait pas : il n'ouvre RIEN d'autre. Une passerelle sans clé,
	 * une passerelle d'environnement inconnu et une boutique sans passerelle
	 * refusent toujours.
	 */
	public static function test_mode_assumed(): bool {
		return 'oui' === (string) get_option( self::OPTION_ESSAI, 'non' );
	}

	/**
	 * Dire au client que rien ne sera prélevé, là où il s'apprête à payer.
	 *
	 * Sans cette phrase, un consommateur français finit un parcours d'achat, voit
	 * une confirmation, et croit avoir payé une commande qui ne sera jamais
	 * produite. C'est la contrepartie non négociable du réglage ci-dessus.
	 */
	public static function notice_test_mode(): void {
		if ( ! self::test_mode_assumed() || ! function_exists( 'wc_print_notice' ) ) {
			return;
		}
		wc_print_notice(
			__( 'Cette boutique est en cours d’ouverture : les paiements sont en mode d’essai. Aucun montant n’est prélevé et aucune commande n’est mise en production. Pour commander pour de vrai, écrivez-nous.', 'teeshoop' ),
			'notice'
		);
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
		$offered = 0;
		foreach ( $gateways as $gateway ) {
			if ( ! $gateway['offered'] ) {
				// Enabled and invisible is a misconfiguration, not a rail.
				return false;
			}
			if ( self::LIVE !== $gateway['environment'] ) {
				return false;
			}
			++$offered;
		}
		return $offered > 0;
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

	// ── The money door, held ─────────────────────────────────────────────────

	/**
	 * No customer is offered a way to pay while the money door refuses.
	 *
	 * FAIL CLOSED IN EVERY DIRECTION. An unreadable argument, a missing `Launch`
	 * and a throw from inside the door all return an EMPTY list, because "we
	 * could not establish the state of the gate" is not "the gate is open". The
	 * cost of being wrong the other way is a customer paying for a garment we
	 * cannot source, or one sold under what it costs to make.
	 *
	 * @param mixed $available The gateways WooCommerce would offer.
	 * @return array<string,\WC_Payment_Gateway>
	 */
	public static function hold_gateways( $available ): array {
		if ( ! is_array( $available ) ) {
			return array();
		}
		if ( self::$inspecting ) {
			// `enabled()` describing the shop, not a customer being served.
			return $available;
		}
		if ( ! class_exists( __NAMESPACE__ . '\\Launch' ) ) {
			return array();
		}

		self::$offered = array_map( 'strval', array_keys( $available ) );
		try {
			$refuses = Launch::money_refuses();
		} catch ( \Throwable $e ) {
			return array();
		} finally {
			self::$offered = null;
		}

		return $refuses ? array() : $available;
	}

	/**
	 * Refuse the write that switches a payment method on.
	 *
	 * WooCommerce 11.0.1 sends both paths through the same filter, which is why
	 * one hook is enough and why it was worth reading the source rather than
	 * guessing: `WC_Settings_API::update_option()` (line 197), which the
	 * payments-list toggle calls, and `process_admin_options()` (line 238),
	 * which a gateway's own settings screen calls, both write through
	 * `apply_filters( 'woocommerce_settings_api_sanitized_fields_' . $id, ... )`.
	 * We hook the option instead, `pre_update_option_{$option}`, because that
	 * also catches a write that never went through `WC_Settings_API` at all.
	 *
	 * ONLY THE TRANSITION TO ON. Turning a gateway OFF is always allowed: a gate
	 * that trapped an operator in the state it dislikes would be a worse gate.
	 *
	 * @param mixed $value     The settings array about to be written.
	 * @param mixed $old_value What is stored today.
	 * @return mixed
	 */
	public static function refuse_enabling( $value, $old_value = null ) {
		if ( ! is_array( $value ) ) {
			return $value;
		}
		// WC_Settings_API stores 'yes' and 'no', literally, in both paths above.
		$becoming = 'yes' === strtolower( trim( (string) ( $value['enabled'] ?? '' ) ) );
		$was      = is_array( $old_value ) && 'yes' === strtolower( trim( (string) ( $old_value['enabled'] ?? '' ) ) );
		if ( ! $becoming || $was ) {
			return $value;
		}
		if ( ! class_exists( __NAMESPACE__ . '\\Launch' ) ) {
			$value['enabled'] = 'no';
			return $value;
		}

		/*
		 * UNE PORTE QUI EXPLOSE NE LAISSE PAS PASSER. Une exception ici partirait
		 * dans `update_option()`, c'est-à-dire en plein enregistrement de
		 * réglages, et la page blanchirait ; l'avaler allumerait la passerelle.
		 * Le refus est la troisième réponse, et c'est la seule sûre.
		 */
		try {
			$why = Launch::activation_blockers();
		} catch ( \Throwable $e ) {
			$value['enabled'] = 'no';
			self::remember_refusal( array( array( 'pourquoi' => 'Le portail de mise en ligne n’a pas pu être évalué : ' . $e->getMessage() ) ) );
			return $value;
		}
		if ( array() === $why ) {
			return $value;
		}

		self::remember_refusal( $why );
		$value['enabled'] = 'no';
		self::force_object_off( $old_value );
		return $value;
	}

	/**
	 * Éteindre aussi l'objet passerelle en mémoire, pas seulement l'option.
	 *
	 * DÉFAUT MESURÉ. `WC_REST_Payment_Gateways_V2_Controller::update_item()` fait
	 * `$gateway->enabled = 'yes'` PUIS `update_option()`, et construit sa réponse
	 * en relisant `$gateway->enabled`. Le refus écrit bien « no » dans la base,
	 * mais l'API répondait 200 avec `enabled: true` : un intégrateur, ou une clé
	 * read_write, concluait que la caisse était ouverte alors qu'elle est fermée.
	 * Remettre la propriété de l'objet aligne ce que l'API dit sur ce que la base
	 * contient.
	 *
	 * @param mixed $old_value Les réglages d'avant, pour retrouver la passerelle.
	 */
	private static function force_object_off( $old_value ): void {
		if ( ! function_exists( 'WC' ) || ! WC()->payment_gateways() ) {
			return;
		}
		$courant = current_filter();
		if ( ! is_string( $courant ) || '' === $courant ) {
			return;
		}
		foreach ( WC()->payment_gateways()->payment_gateways() as $gateway ) {
			if ( ! $gateway instanceof \WC_Payment_Gateway ) {
				continue;
			}
			if ( 'pre_update_option_' . $gateway->get_option_key() === $courant ) {
				$gateway->enabled = 'no';
				if ( is_array( $gateway->settings ) ) {
					$gateway->settings['enabled'] = 'no';
				}
				return;
			}
		}
	}

	/**
	 * Register the refusal on every gateway's settings option.
	 *
	 * @param mixed $gateways The WC_Payment_Gateways instance WooCommerce passes.
	 */
	public static function guard_gateway_options( $gateways = null ): void {
		if ( ! is_object( $gateways ) || ! method_exists( $gateways, 'payment_gateways' ) ) {
			return;
		}
		foreach ( $gateways->payment_gateways() as $gateway ) {
			if ( ! $gateway instanceof \WC_Payment_Gateway ) {
				continue;
			}
			add_filter(
				'pre_update_option_' . $gateway->get_option_key(),
				array( self::class, 'refuse_enabling' ),
				10,
				2
			);
		}
	}

	/**
	 * Answer the payments-list toggle before WooCommerce writes anything.
	 *
	 * WHY IT ANSWERS « THE SWITCH IS OFF » RATHER THAN AN ERROR. Read in the
	 * shipped `assets/js/admin/woocommerce_admin.min.js` on 05/09/2026: the
	 * success handler acts on exactly three values, `true`, `false` and
	 * `'needs_setup'`, and IGNORES everything else. An error response with our
	 * sentence in it would leave the toggle spinning for ever and say nothing.
	 * `false` makes the control snap back to off, which is the truth (it was off
	 * and it stays off), and the reason is waiting in `gate_notice()` on the next
	 * screen. A control that says what happened beats a control that hangs.
	 *
	 * The write is refused again by `refuse_enabling()` whatever happens here.
	 * This exists for the operator, not for the guarantee.
	 */
	public static function refuse_toggle(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		// False, so a bad nonce falls through to WooCommerce's own rejection
		// rather than being answered by us.
		if ( ! check_ajax_referer( 'woocommerce-toggle-payment-gateway-enabled', 'security', false ) ) {
			return;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
		$id = isset( $_POST['gateway_id'] ) ? wc_clean( wp_unslash( $_POST['gateway_id'] ) ) : '';
		if ( ! is_string( $id ) || '' === $id || ! function_exists( 'WC' ) ) {
			return;
		}

		foreach ( WC()->payment_gateways()->payment_gateways() as $gateway ) {
			if ( ! $gateway instanceof \WC_Payment_Gateway ) {
				continue;
			}
			if ( ! in_array( $id, array( (string) $gateway->id, sanitize_title( get_class( $gateway ) ) ), true ) ) {
				continue;
			}
			if ( 'yes' === strtolower( trim( (string) $gateway->get_option( 'enabled', 'no' ) ) ) ) {
				// The click turns it OFF. Never our business.
				return;
			}
			try {
				$why = class_exists( __NAMESPACE__ . '\\Launch' )
					? Launch::activation_blockers()
					: array( array( 'pourquoi' => 'Le portail de mise en ligne n’a pas pu être chargé.' ) );
			} catch ( \Throwable $e ) {
				// Fail closed, ici comme partout : on refuse ce qu'on n'a pas pu juger.
				$why = array( array( 'pourquoi' => 'Le portail de mise en ligne n’a pas pu être évalué : ' . $e->getMessage() ) );
			}
			if ( array() === $why ) {
				return;
			}
			self::remember_refusal( $why );
			wp_send_json_success( false );
		}
	}

	/**
	 * Keep the reasons for the operator who just clicked.
	 *
	 * @param array<int,array<string,mixed>> $why Refusals from `Launch`.
	 */
	private static function remember_refusal( array $why ): void {
		$lines = array();
		foreach ( $why as $blocker ) {
			$line = trim( (string) ( $blocker['pourquoi'] ?? '' ) );
			if ( '' !== $line ) {
				$lines[] = $line;
			}
		}
		// Long enough to survive the redirect that follows a settings save, short
		// enough that yesterday's refusal is not shown as today's.
		set_transient( self::TRANSIENT_REFUS, $lines, 5 * MINUTE_IN_SECONDS );
	}

	/**
	 * Say, in the administration, that the money door is holding the till shut.
	 *
	 * TWO DIFFERENT MESSAGES, because they answer two different questions. The
	 * first is the answer to a click that has just been refused, and it is shown
	 * wherever the operator happens to be. The second is the standing state, and
	 * it is shown only where somebody would act on it: a banner on all fifty
	 * screens of WordPress is a banner nobody reads.
	 */
	public static function gate_notice(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		$refused = get_transient( self::TRANSIENT_REFUS );
		if ( is_array( $refused ) && array() !== $refused ) {
			delete_transient( self::TRANSIENT_REFUS );
			echo '<div class="notice notice-error"><p><strong>Teeshoop</strong> : ';
			esc_html_e( 'ce moyen de paiement n’a pas été activé. La boutique n’est pas en état d’encaisser :', 'teeshoop' );
			echo '</p><ul style="list-style:disc;margin-left:1.5em">';
			foreach ( $refused as $line ) {
				echo '<li>' . esc_html( (string) $line ) . '</li>';
			}
			echo '</ul><p>';
			esc_html_e( 'Corrigez ces points, puis réactivez le moyen de paiement. Le détail est sur l’écran Dette de lancement.', 'teeshoop' );
			echo '</p></div>';
			return;
		}

		if ( ! self::on_a_screen_that_acts() || ! class_exists( __NAMESPACE__ . '\\Launch' ) ) {
			return;
		}

		// `money_hold()` et non `money_blockers()` : il attrape sa propre panne et
		// la rend comme un refus, au lieu de la laisser tuer la page d'administration.
		$why = Launch::money_hold();
		if ( array() === $why ) {
			return;
		}

		echo '<div class="notice notice-error"><p><strong>Teeshoop</strong> : ';
		echo esc_html(
			sprintf(
				/* translators: %d: how many conditions refuse. */
				_n(
					'aucun moyen de paiement n’est proposé au client, et aucun ne peut être activé. %d condition n’est pas tenue.',
					'aucun moyen de paiement n’est proposé au client, et aucun ne peut être activé. %d conditions ne sont pas tenues.',
					count( $why ),
					'teeshoop'
				),
				count( $why )
			)
		);
		echo '</p><ul style="list-style:disc;margin-left:1.5em">';
		foreach ( array_slice( $why, 0, 5 ) as $blocker ) {
			echo '<li>' . esc_html( (string) ( $blocker['pourquoi'] ?? '' ) ) . '</li>';
		}
		echo '</ul><p><a href="' . esc_url( admin_url( 'admin.php?page=teeshoop-dette' ) ) . '">';
		esc_html_e( 'Voir la dette de lancement', 'teeshoop' );
		echo '</a></p></div>';
	}

	/**
	 * The screens where an operator would act on a payment problem.
	 *
	 * A banner on all fifty screens of WordPress is a banner nobody reads, and
	 * the quality bar forbids badge soup. These three are where somebody is
	 * either configuring payment or reading the shop's state.
	 */
	private static function on_a_screen_that_acts(): bool {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		$id     = $screen ? (string) ( $screen->id ?? '' ) : '';
		return false !== strpos( $id, 'wc-settings' )
			|| false !== strpos( $id, 'wc-status' )
			|| false !== strpos( $id, 'teeshoop-dette' );
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
		 * SE TAIRE LÀ OÙ LA PORTE PARLE DÉJÀ. Sur les écrans de réglages,
		 * `gate_notice()` liste les refus de la porte de l'argent, dont ceux-ci
		 * font partie : les mêmes phrases deux fois sur un écran sont du bruit,
		 * et le bruit est ce qui fait qu'on cesse de lire les bandeaux. Ailleurs
		 * dans l'administration, où la porte se tait, celui-ci reste le seul à
		 * dire qu'une passerelle est mal réglée.
		 */
		if ( self::on_a_screen_that_acts() && class_exists( __NAMESPACE__ . '\\Launch' ) && Launch::money_refuses() ) {
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
