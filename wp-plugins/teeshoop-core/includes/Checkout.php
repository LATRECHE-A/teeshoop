<?php
/**
 * The gates between a basket and an order, and what the order remembers.
 *
 * THE HOOK CHOICE IS THE WHOLE FILE. `woocommerce_after_checkout_validation` is
 * what every tutorial reaches for, and it has exactly ONE `do_action` site in
 * WooCommerce 11.0.1, inside `WC_Checkout::validate_checkout()`, reachable only
 * from the classic checkout POST. The Checkout block never goes near it: it
 * posts to `/wc/store/v1/checkout` and validates through
 * `StoreApi\Utilities\CartController::validate_cart()`. A minimum enforced there
 * alone is a minimum a block checkout walks straight through, and the order it
 * produces is real, paid and printable.
 *
 * `woocommerce_check_cart_items` is the one hook that fires on all four paths:
 * the classic cart page, the classic checkout render, the classic checkout POST,
 * and the Store API the block uses. Everything that refuses a basket is on it.
 * `Cart::check_cart_items` already uses it for the per-line rules; this adds the
 * rules that are about the basket as a whole and about the shop's own state.
 *
 * AND ONE INVARIANT THAT IS NOT A GATE. `assert_total` recomputes every
 * personalised line from `Pricing.php` at the moment the order is created and
 * refuses if the sum disagrees with what WooCommerce is about to charge. It is
 * the guarantee a hand-written payment gateway would have bought us, without a
 * line of gateway code: nothing gets to be paid for at a total this repository
 * cannot re-derive.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Checkout {

	/** Order meta: the regime the order was taken under, frozen. */
	public const META_VAT_REGIME = '_teeshoop_vat_regime';
	public const META_VAT_RATE   = '_teeshoop_vat_rate';
	public const META_VAT_FROM   = '_teeshoop_vat_period_from';
	public const META_VAT_NOTE   = '_teeshoop_vat_mention';

	/** Order meta: how the amounts were arrived at. */
	public const META_BASIS   = '_teeshoop_price_basis';
	public const META_CONFIG  = '_teeshoop_pricing_config';
	public const META_VERSION = '_teeshoop_plugin_version';

	public static function init(): void {
		add_action( 'woocommerce_check_cart_items', array( self::class, 'check_basket' ), 20 );

		/*
		 * Frozen twice, on purpose, and idempotently.
		 *
		 * `woocommerce_checkout_create_order` fires before the order's first
		 * save on the classic path and never on the Store API's;
		 * `woocommerce_new_order` fires on both, after the save. Writing on the
		 * first is one database round-trip cheaper, writing on the second is
		 * what makes the block checkout carry the same facts, and writing on
		 * both twice is what `freeze` refuses to do.
		 */
		add_action( 'woocommerce_checkout_create_order', array( self::class, 'freeze_on_create' ), 10, 1 );
		add_action( 'woocommerce_new_order', array( self::class, 'freeze_on_new' ), 10, 2 );

		add_action( 'woocommerce_checkout_order_processed', array( self::class, 'assert_total' ), 10, 3 );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( self::class, 'assert_total_block' ), 10, 1 );

		/*
		 * ABSOLUTE PRICES AND DISCOUNT CODES DO NOT MIX, so the codes are off.
		 *
		 * `Pricing::quote()` already carries the quantity discount inside the
		 * unit price it hands WooCommerce. A coupon applies a second reduction
		 * on top of that, from a rule nobody has written, on a shop whose margin
		 * engine does not know it happened. Nothing in the Bible or in
		 * QUESTIONS-ASSOCIE.md establishes a promotional policy, so there is no
		 * rule to implement and the honest state is off rather than a code that
		 * silently discounts below the floor price.
		 */
		add_filter( 'woocommerce_coupons_enabled', '__return_false' );

		self::register_siret_field();
	}

	/**
	 * Ask for the buyer's SIRET, and never block on it.
	 *
	 * QUESTION 01'S OTHER HALF. Its written default is "SIRET demandé mais non
	 * bloquant", and until now it was asked only on the quote form, so a buyer
	 * who paid in one go was never asked at all. Article 242 nonies A, I, 1° of
	 * annexe II au CGI wants the customer's identifier on the invoice; a
	 * customer who declines to give it still gets a document, and the invoice
	 * prints it only when it is there.
	 *
	 * REGISTERED TWICE, because WooCommerce has two checkouts. The Store API's
	 * own registry is the only thing the block reads, and a field added through
	 * `woocommerce_billing_fields` alone is invisible there: a shop that had
	 * switched to the block checkout would silently stop asking.
	 */
	private static function register_siret_field(): void {
		add_filter(
			'woocommerce_billing_fields',
			static function ( array $fields ): array {
				$fields['billing_siret'] = array(
					'label'       => __( 'SIRET', 'teeshoop' ),
					'required'    => false,
					'class'       => array( 'form-row-wide' ),
					'priority'    => 35,
					'description' => __( 'Facultatif. Il figure sur votre facture si vous le renseignez.', 'teeshoop' ),
				);
				return $fields;
			}
		);

		if ( ! function_exists( 'woocommerce_register_additional_checkout_field' ) ) {
			return;
		}
		add_action(
			'woocommerce_init',
			static function (): void {
				woocommerce_register_additional_checkout_field(
					array(
						'id'          => 'teeshoop/siret',
						'label'       => __( 'SIRET', 'teeshoop' ),
						'location'    => 'address',
						'type'        => 'text',
						'required'    => false,
						/*
						 * NO `attributes`. The block checkout is React, and it
						 * passes what is given here straight to the DOM: an
						 * `autocomplete` key produced "Invalid DOM property
						 * autocomplete, did you mean autoComplete" in the console
						 * of every checkout, which the end-to-end harness
						 * refused to pass. A console error on the page where
						 * money changes hands is not worth an input hint.
						 */
					)
				);
			}
		);
		// The block writes its own key; the invoice reads one. Copied across at
		// order creation rather than read from two places, because two readers
		// of one fact is how the classic checkout and the block end up printing
		// different invoices.
		add_action(
			'woocommerce_store_api_checkout_update_order_from_request',
			static function ( \WC_Order $order ): void {
				$siret = (string) $order->get_meta( '_wc_billing/teeshoop/siret', true );
				if ( '' !== $siret ) {
					$order->update_meta_data( '_billing_siret', $siret );
				}
			},
			10,
			1
		);
	}

	/**
	 * Everything that can refuse a basket as a whole.
	 *
	 * Ordered so the customer reads their own problem first and the shop's own
	 * problems after: a minimum they can fix is more useful to them than a
	 * configuration fault they cannot.
	 */
	public static function check_basket(): void {
		if ( ! function_exists( 'WC' ) || ! WC()->cart || ! function_exists( 'wc_add_notice' ) ) {
			return;
		}
		$cart = WC()->cart;
		if ( $cart->is_empty() ) {
			return;
		}
		if ( is_admin() && ! wp_doing_ajax() ) {
			return;
		}

		self::check_minimum( $cart );
		self::check_shipping();
		self::check_no_third_party_fee( $cart );
		self::check_shop_can_sell( $cart );
	}

	/**
	 * The minimum order, question 01: five pieces and 50,00 EUR hors taxes.
	 *
	 * Counted over the WHOLE basket and not per line, because that is what "à la
	 * validation du panier" means and because three tees plus three hoodies is
	 * six garments the workshop is glad to press.
	 *
	 * The message names what is missing, not only what the rule is. "Minimum 5
	 * pièces" tells a customer with three that they are refused; "il vous manque
	 * 2 pièces" tells them what to do, and it is the same sentence length.
	 */
	private static function check_minimum( \WC_Cart $cart ): void {
		$config = Settings::pricing();

		$pieces   = (int) $cart->get_cart_contents_count();
		$goods_ht = Money::from_eur( (string) $cart->get_subtotal() );
		$verdict  = Pricing::below_minimum( $pieces, $goods_ht, $config );

		if ( ! $verdict['below'] ) {
			return;
		}

		$parts = array();
		if ( $verdict['qty'] ) {
			$short   = $verdict['min_qty'] - $pieces;
			$parts[] = sprintf(
				/* translators: 1: a number of garments still needed, 2: the shop's minimum. */
				_n(
					'il manque %1$d pièce pour atteindre le minimum de %2$d',
					'il manque %1$d pièces pour atteindre le minimum de %2$d',
					$short,
					'teeshoop'
				),
				$short,
				$verdict['min_qty']
			);
		}
		if ( $verdict['ht'] ) {
			$parts[] = sprintf(
				/* translators: 1: an amount excl. VAT still needed, 2: the shop's minimum. */
				__( 'il manque %1$s hors taxes pour atteindre le minimum de %2$s', 'teeshoop' ),
				Money::format( $verdict['min_ht'] - $goods_ht ),
				Money::format( $verdict['min_ht'] )
			);
		}

		wc_add_notice(
			sprintf(
				/* translators: %s: one or two clauses saying what the basket is short of. */
				__( 'Nous produisons à partir de %s. Ajoutez des pièces à votre commande, ou demandez un devis pour un cas particulier.', 'teeshoop' ),
				implode( __( ' et ', 'teeshoop' ), $parts )
			),
			'error'
		);
	}

	/**
	 * Say why there is no delivery option, rather than showing an empty selector.
	 *
	 * A shipping list with nothing in it and no sentence beside it is the single
	 * most abandoning thing a checkout does, and WooCommerce's own fallback
	 * ("Aucun mode de livraison disponible") tells the customer nothing they can
	 * act on. `Shipping` records why it declined and this prints that reason.
	 */
	private static function check_shipping(): void {
		if ( ! WC()->cart->needs_shipping() ) {
			return;
		}

		/*
		 * Gated on the basket ACTUALLY having no delivery option, not merely on
		 * a refusal having been recorded. Those are different: a shop can offer
		 * a second method we know nothing about, and a package we declined is
		 * not a basket that cannot be shipped.
		 */
		foreach ( (array) WC()->shipping()->get_packages() as $package ) {
			if ( ! empty( $package['rates'] ) ) {
				return;
			}
		}

		$reason = Shipping::last_refusal();
		if ( '' === $reason ) {
			return;
		}
		$message = Shipping::refusal_message( $reason, Shipping::config() );
		if ( ! wc_has_notice( $message, 'error' ) ) {
			wc_add_notice( $message, 'error' );
		}
	}

	/**
	 * Refuse a basket another extension has added a charge to.
	 *
	 * Our line prices are absolute and server-derived, and the margin engine of
	 * session 05 reconstructs an order from them. A fee added by something else
	 * moves the total without moving any line, so the order would be paid at one
	 * number and explained at another. There is no legitimate fee on this shop
	 * today: chapter 1 of the Bible explicitly forbids the one that would be
	 * tempting, "pour éviter les frais cachés, le système peut intégrer le coût
	 * de préparation directement dans le prix unitaire ... il n'est pas surpris
	 * par une ligne artificielle ajoutée au dernier moment", and surcharging a
	 * card payment is illegal in France anyway (article L112-12 du code
	 * monétaire et financier).
	 *
	 * So it refuses, and it tells the customer something true and actionable
	 * while the detail goes where an operator will see it.
	 */
	private static function check_no_third_party_fee( \WC_Cart $cart ): void {
		$fees = $cart->get_fees();
		if ( empty( $fees ) ) {
			return;
		}

		$names = array();
		foreach ( $fees as $fee ) {
			$names[] = (string) ( $fee->name ?? '?' );
		}
		self::log( 'refused a basket carrying fees added elsewhere: ' . implode( ', ', $names ) );

		wc_add_notice(
			__( 'Un supplément a été ajouté à ce panier par un autre module, et nos prix n’en tiennent pas compte. Nous préférons ne pas encaisser un total que nous ne savons pas expliquer : écrivez-nous et nous reprenons la commande à la main.', 'teeshoop' ),
			'error'
		);
	}

	/**
	 * Refuse to sell at all when the shop is not in a state to invoice.
	 *
	 * Three separate faults, all of them ours and none of them the customer's,
	 * and all three make a sale that cannot be turned into a lawful document:
	 *
	 *   no VAT regime covers today, so nobody can say whether this sale carries
	 *   tax (see Vat.php and constat 6 of QUESTIONS-ASSOCIE.md);
	 *
	 *   WooCommerce's own tax engine contradicts that regime, so the customer
	 *   would be charged one thing and invoiced another;
	 *
	 *   the seller's legal identity is incomplete, in production. On a
	 *   developer's machine and on the preproduction this does not block, and
	 *   the invoice comes out stamped instead, because work has to be possible.
	 *
	 * The message says the same thing to everyone, because a customer does not
	 * need to know which of our three faults it is, and the operator gets the
	 * detail from `Compat::check()` and the admin notice.
	 */
	private static function check_shop_can_sell( \WC_Cart $cart ): void {
		$problems = self::selling_problems( $cart );
		if ( empty( $problems ) ) {
			return;
		}
		self::log( 'refused a basket: ' . implode( ' / ', $problems ) );

		wc_add_notice(
			__( 'La boutique ne peut pas enregistrer de commande pour le moment : un réglage de facturation est incomplet de notre côté. Votre panier est conservé. Écrivez-nous et nous finalisons la commande avec vous.', 'teeshoop' ),
			'error'
		);
	}

	/**
	 * Why the shop cannot take an order, for the operator.
	 *
	 * Public and separate from the notice so `Compat::check()`, `wp teeshoop
	 * check` and the tests all read the same verdict rather than three copies.
	 *
	 * @return string[]
	 */
	public static function selling_problems( ?\WC_Cart $cart = null, ?string $environment = null ): array {
		$problems = array();

		$regime = Settings::vat();
		if ( ! $regime['known'] ) {
			$problems[] = __( 'Aucune période de TVA ne couvre la date du jour : la boutique ne peut pas dire si cette vente porte de la TVA.', 'teeshoop' );
		} else {
			$mismatch = self::woo_tax_mismatch( $regime );
			if ( '' !== $mismatch ) {
				$problems[] = $mismatch;
			}
		}

		$verdict = Legal::verdict(
			Legal::identity(),
			(string) $regime['regime'],
			// Threaded rather than read, so the production branch of the gate
			// can be exercised by a test without a runtime seam that a plugin
			// could hook to switch it off on the real shop.
			null === $environment ? Legal::environment() : $environment
		);
		if ( Legal::REFUSE === $verdict['action'] ) {
			$problems[] = sprintf(
				/* translators: %s: a list of missing legal fields. */
				__( 'L’identité légale du vendeur est incomplète : %s. Aucune facture conforme ne peut être émise.', 'teeshoop' ),
				implode( ', ', $verdict['labels'] )
			);
		}

		/*
		 * GARMENTS THAT COST NOTHING ARE NOT GARMENTS THAT ARE FREE.
		 *
		 * A pricing config zeroed by a bad edit does not fail loudly: it prints
		 * and posts fifty garments for nothing. And WooCommerce skips payment
		 * entirely when the ORDER total is zero, which is the exact shape of the
		 * "test mode that falls back to no payment required" failure.
		 *
		 * The two are checked separately because they are different faults and
		 * only one of them is caught by the other: a basket of free garments
		 * plus paid carriage has a non-zero total and is still a run the
		 * workshop would press for nothing. The minimum above makes both nearly
		 * impossible, and nearly is not a guarantee.
		 */
		if ( $cart instanceof \WC_Cart && ! $cart->is_empty() ) {
			if ( Money::from_eur( (string) $cart->get_subtotal() ) <= 0 ) {
				$problems[] = __( 'Les articles de ce panier ne coûtent rien : le tarif est mal réglé, et la commande serait produite sans être payée.', 'teeshoop' );
			} elseif ( Money::from_eur( (string) $cart->get_total( 'edit' ) ) <= 0 ) {
				$problems[] = __( 'Le total de ce panier est nul alors qu’il contient des articles : aucun paiement ne serait demandé.', 'teeshoop' );
			}
		}

		return $problems;
	}

	/**
	 * Whether WooCommerce's tax engine charges what the regime says, or ''.
	 *
	 * The two are separate implementations by construction: ours decides what a
	 * page prints and what an invoice says, WooCommerce's decides what the
	 * customer is actually charged. They must never be allowed to disagree, and
	 * under franchise the correct WooCommerce state is taxes OFF, which is
	 * exactly the state the live shop is in today with nobody having decided it.
	 */
	public static function woo_tax_mismatch( array $regime ): string {
		if ( ! function_exists( 'wc_get_base_location' ) || ! class_exists( '\WC_Tax' ) ) {
			return '';
		}

		$calc = 'yes' === get_option( 'woocommerce_calc_taxes' );

		if ( Vat::FRANCHISE === $regime['regime'] ) {
			return $calc
				? __( 'La boutique est déclarée en franchise en base de TVA et WooCommerce calcule quand même des taxes. Le client paierait une TVA que la facture ne peut pas mentionner.', 'teeshoop' )
				: '';
		}

		if ( ! $calc ) {
			return __( 'La boutique est déclarée assujettie à la TVA et le calcul des taxes est désactivé dans WooCommerce. Le client paierait le montant hors taxes.', 'teeshoop' );
		}

		$base    = wc_get_base_location();
		$charged = 0.0;
		foreach ( \WC_Tax::find_rates( array( 'country' => $base['country'] ?? '', 'state' => $base['state'] ?? '' ) ) as $rate ) {
			$charged += (float) $rate['rate'];
		}
		$charged /= 100;

		// A hundredth of a point of tolerance: the tax table stores a string
		// percentage and the regime stores a float.
		if ( abs( $charged - (float) $regime['rate'] ) < 0.0001 ) {
			return '';
		}

		return sprintf(
			/* translators: 1: the rate the regime carries, 2: the rate WooCommerce charges. */
			__( 'Le régime de TVA en vigueur est à %1$s et WooCommerce en facture %2$s.', 'teeshoop' ),
			Money::number( (float) $regime['rate'] * 100, 2 ) . "\u{00A0}%",
			Money::number( $charged * 100, 2 ) . "\u{00A0}%"
		);
	}

	// ── What the order remembers ─────────────────────────────────────────────

	public static function freeze_on_create( \WC_Order $order ): void {
		self::freeze( $order );
	}

	/**
	 * @param int       $order_id
	 * @param \WC_Order $order
	 */
	public static function freeze_on_new( $order_id, $order = null ): void {
		if ( ! $order instanceof \WC_Order ) {
			$order = wc_get_order( (int) $order_id );
		}
		if ( ! $order instanceof \WC_Order ) {
			return;
		}
		if ( self::freeze( $order ) ) {
			$order->save();
		}
	}

	/**
	 * Write the rules this order was taken under, once.
	 *
	 * NOT ONLY THE AMOUNTS. An order that carries 926,50 EUR and 185,30 EUR of
	 * VAT can be read eighteen months later and still not be explainable: was
	 * that 20 % because the company was assujettie, or because somebody had left
	 * a rate in a box? Was the unit price the tier it looks like? The amounts are
	 * the answer; these are the question they answer.
	 *
	 * The whole price config goes in, not a hash of it. A fingerprint tells a
	 * reader that something changed and not what, and the person reading this in
	 * 2028 will be an accountant or a customer, not a developer with the
	 * repository open. It is under a leading underscore, so it is out of the
	 * customer's order view and out of the order emails.
	 *
	 * @return bool whether anything was written.
	 */
	public static function freeze( \WC_Order $order ): bool {
		if ( '' !== (string) $order->get_meta( self::META_BASIS, true ) ) {
			return false;
		}

		$config = Settings::pricing();
		$regime = Settings::vat();

		$order->update_meta_data( self::META_VAT_REGIME, $regime['known'] ? (string) $regime['regime'] : 'inconnu' );
		$order->update_meta_data( self::META_VAT_RATE, number_format( (float) $regime['rate'], 4, '.', '' ) );
		$order->update_meta_data( self::META_VAT_FROM, (string) $regime['from'] );
		$order->update_meta_data( self::META_VAT_NOTE, (string) $regime['mention'] );

		/*
		 * HT, always, and written down rather than assumed. Every amount this
		 * plugin computes is excluding tax in integer cents; if question 01 ever
		 * comes back "consumers too" and the shop starts DISPLAYING TTC first,
		 * the stored basis must still say what these figures are.
		 */
		$order->update_meta_data( self::META_BASIS, 'ht' );

		/*
		 * The buyer's SIRET, from wherever their checkout put it. WooCommerce
		 * stores a custom billing field on the order under its own key on the
		 * classic path and under a namespaced one on the block path; the invoice
		 * reads exactly one.
		 */
		$siret = '';
		foreach ( array( '_billing_siret', '_wc_billing/teeshoop/siret' ) as $key ) {
			$found = (string) $order->get_meta( $key, true );
			if ( '' !== $found ) {
				$siret = $found;
				break;
			}
		}
		if ( '' === $siret && function_exists( 'WC' ) && WC()->checkout() ) {
			$siret = (string) WC()->checkout()->get_value( 'billing_siret' );
		}
		if ( '' !== $siret ) {
			$order->update_meta_data( '_billing_siret', sanitize_text_field( $siret ) );
		}

		$order->update_meta_data( self::META_CONFIG, wp_json_encode( $config ) );
		$order->update_meta_data( self::META_VERSION, VERSION );

		return true;
	}

	// ── The invariant ────────────────────────────────────────────────────────

	/**
	 * @param int   $order_id
	 * @param array $posted
	 * @param mixed $order
	 */
	public static function assert_total( $order_id, $posted = array(), $order = null ): void {
		if ( ! $order instanceof \WC_Order ) {
			$order = wc_get_order( (int) $order_id );
		}
		if ( $order instanceof \WC_Order ) {
			self::assert_total_block( $order );
		}
	}

	/**
	 * Refuse an order whose personalised lines do not add up to what we would
	 * charge for them.
	 *
	 * This is the guarantee a hand-written payment gateway would have bought,
	 * and it costs thirty lines instead of an SCA implementation: whatever the
	 * rail, whatever the checkout, an order only reaches a gateway at a total
	 * this repository can re-derive from the line's own stored inputs.
	 *
	 * It compares the SUM OF THE PERSONALISED LINES and not the order total,
	 * because shipping, tax and anything else legitimately sit outside it. What
	 * it catches is the class of bug this project has already had once: correct
	 * pricing code on one side of a WooCommerce seam and a stale number on the
	 * other.
	 *
	 * @throws \Exception to abort the checkout, which is how both the classic
	 *                    and the Store API paths surface a refusal.
	 */
	public static function assert_total_block( \WC_Order $order ): void {
		$config   = Settings::pricing();
		$expected = 0;
		$found    = 0;
		$lines    = 0;

		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$garment = (string) $item->get_meta( '_teeshoop_garment', true );
			if ( '' === $garment ) {
				continue;
			}
			$sides = json_decode( (string) $item->get_meta( '_teeshoop_sides', true ), true );

			try {
				$quote = Pricing::quote(
					array(
						'garment' => $garment,
						'qty'     => (int) $item->get_quantity(),
						'sides'   => is_array( $sides ) ? $sides : array(),
					),
					$config
				);
			} catch ( \InvalidArgumentException $e ) {
				throw new \Exception(
					esc_html__( 'Un article de cette commande ne peut plus être chiffré. Rien n’a été encaissé, écrivez-nous et nous la reprenons à la main.', 'teeshoop' )
				);
			}

			++$lines;
			$expected += (int) $quote['total_ht'];
			$found    += Money::from_eur( (string) $item->get_total() );
		}

		if ( 0 === $lines || $expected === $found ) {
			return;
		}

		self::log( sprintf( 'total mismatch on order %d: expected %d cents, order carries %d', $order->get_id(), $expected, $found ) );

		throw new \Exception(
			esc_html__( 'Le total de cette commande ne correspond pas à notre tarif. Rien n’a été encaissé. Rechargez le panier et réessayez, ou écrivez-nous.', 'teeshoop' )
		);
	}

	private static function log( string $message ): void {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( '[teeshoop] ' . $message ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		}
	}
}
