<?php
/**
 * The money an order has actually received, on the order.
 *
 * `Settlement.php` holds the arithmetic and the rule; this holds the record and
 * the WooCommerce surface around it. The split is the usual one here: one file
 * that a bare PHP process can test, one file that needs a shop.
 *
 * WHY A LEDGER AND NOT A FIELD. WooCommerce stores one fact about money, the
 * date an order was paid, and it is a date or nothing. An order settled in two
 * transfers has two facts, each with its own date, its own means and its own
 * reference, and the Bible needs all of them: "commission commerciale calculée
 * uniquement sur l'encaissement réel" (chapter 2) cannot be computed from a
 * boolean, and neither can "solde avant expédition". So each receipt is a row.
 *
 * NOTHING HERE TRUSTS A BROWSER. The Bible is explicit and it matches this
 * project's own doctrine: "le retour navigateur du client ne suffit pas à
 * prouver le paiement" (chapter 2, line 296). A receipt is recorded when
 * WooCommerce says a payment completed, or when an operator says a transfer
 * arrived, and never because somebody loaded a page.
 *
 * AND NOTHING HERE IS SELF-SERVE. Question 16's default requires the
 * associate's validation before a deposit is possible at all, so a deposit is
 * authorised by a person on one order, never by a rule on a category of orders.
 * The checkout does not know this file exists.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Ledger {

	/** Order meta: the receipts, as JSON. */
	public const META_RECEIPTS = '_teeshoop_encaissements';

	/** Order meta: the deposit an operator authorised, in cents, or absent. */
	public const META_DEPOSIT = '_teeshoop_acompte_autorise';

	/** The one custom status: a deposit is in and the balance is not. */
	public const STATUS = 'wc-ts-acompte';

	private const ACTION_AUTHORISE = 'teeshoop_acompte_autoriser';
	private const ACTION_RECORD    = 'teeshoop_encaissement';
	private const ACTION_ISSUE     = 'teeshoop_recapitulatifs';

	public static function init(): void {
		/*
		 * BOTH REGISTRATIONS, and each one alone fails silently in a different
		 * way. `wc_get_order_statuses()` reads a hardcoded array plus its own
		 * filter and never consults the post-status registry, so without the
		 * filter `set_status('ts-acompte')` stores `pending`. And the admin
		 * order list builds its All view and its filter links through
		 * `get_post_stati()`, so without the post status the orders exist, the
		 * queries find them, and wp-admin cannot show them. Measured on this
		 * mirror by removing each in turn.
		 *
		 * The post status goes through WooCommerce's own filter rather than a
		 * bare `register_post_status()` on `init`, because that filter runs
		 * inside `WC_Post_Types::register_post_status()` at `init` priority 9
		 * and therefore cannot race with it.
		 */
		add_filter( 'woocommerce_register_shop_order_post_statuses', array( self::class, 'register_status' ) );
		add_filter( 'wc_order_statuses', array( self::class, 'list_status' ) );

		/*
		 * `payment_complete()` must be able to act FROM this status, which is
		 * how the balance lands and how the invoice is issued.
		 *
		 * AND THE ORDER IS DELIBERATELY NOT MADE PAYABLE. Adding it to
		 * `woocommerce_valid_order_statuses_for_payment` makes `needs_payment()`
		 * true, which lights up the My Account "Payer" button, the pay link in
		 * the customer-invoice e-mail and the admin's "Page de paiement du
		 * client", and every one of them charges `$order->get_total()`: the
		 * WHOLE total, again, because WooCommerce has no concept of a remaining
		 * balance anywhere in it. Measured on a 240,00 order with 120,00 banked:
		 * `needs_payment()` true, `get_total()` still 240,00. A deposit is
		 * settled by transfer and recorded here, which is what a French B2B
		 * deposit is anyway, and the three pay surfaces disappear on their own
		 * because all three test `needs_payment()`.
		 */
		add_filter( 'woocommerce_valid_order_statuses_for_payment_complete', array( self::class, 'completable' ) );

		// `wc_order_is_editable`, which is the filter WooCommerce actually has.
		// This was `woocommerce_order_is_editable` for one afternoon, a name
		// that appears nowhere in WooCommerce, so the callback never ran and the
		// file claimed a protection it did not have.
		add_filter( 'wc_order_is_editable', array( self::class, 'not_editable' ), 10, 2 );

		/*
		 * OUT OF THE REPORTS UNTIL IT IS REALLY SOLD. Analytics books the ORDER
		 * total for any status not on its exclusion list, so a 5 472,00 EUR
		 * order sitting on a 2 736,00 EUR deposit would book 5 472,00 EUR of net
		 * sales the day the deposit landed, and book it again from `processing`
		 * when the balance arrived. Excluded, it books once, when the order is
		 * actually paid. This is the same thing WooCommerce does for its own
		 * `checkout-draft`.
		 */
		add_filter( 'woocommerce_analytics_excluded_order_statuses', array( self::class, 'out_of_reports' ) );
		add_action( 'admin_head', array( self::class, 'status_style' ) );

		// The two ways money is recorded: a gateway confirmed it, or an operator
		// saw it arrive. Never a page load.
		add_action( 'woocommerce_payment_complete', array( self::class, 'on_payment' ), 5, 2 );
		add_action( 'woocommerce_order_status_changed', array( self::class, 'on_status' ), 5, 4 );

		add_action( 'add_meta_boxes', array( self::class, 'meta_box' ) );
		add_action( 'admin_post_' . self::ACTION_AUTHORISE, array( self::class, 'handle_authorise' ) );
		add_action( 'admin_post_' . self::ACTION_RECORD, array( self::class, 'handle_record' ) );
		add_action( 'admin_post_' . self::ACTION_ISSUE, array( self::class, 'handle_issue' ) );
	}

	// ── the status ───────────────────────────────────────────────────────────

	/**
	 * @param array $statuses WooCommerce's own shop_order post statuses.
	 */
	public static function register_status( array $statuses ): array {
		$statuses[ self::STATUS ] = array(
			'label'                     => _x( 'Acompte reçu', 'Order status', 'teeshoop' ),
			'public'                    => false,
			/*
			 * FALSE, and it is load-bearing twice. `exclude_from_search => true`
			 * drops the status out of `wc_get_orders( status => 'any' )`, and
			 * `show_in_admin_all_list => false` makes admin search unable to
			 * find a deposit order at all.
			 */
			'exclude_from_search'       => false,
			'show_in_admin_all_list'    => true,
			'show_in_admin_status_list' => true,
			/* translators: %s: order count. */
			'label_count'               => _n_noop( 'Acompte reçu <span class="count">(%s)</span>', 'Acompte reçu <span class="count">(%s)</span>', 'teeshoop' ),
		);
		return $statuses;
	}

	/** @param string[] $statuses */
	public static function out_of_reports( $statuses ): array {
		$statuses   = (array) $statuses;
		$statuses[] = 'ts-acompte';
		return array_values( array_unique( $statuses ) );
	}

	/**
	 * A colour, because an operator scans the order list by colour.
	 *
	 * WooCommerce styles four statuses and no more, so a custom one renders as
	 * an unstyled grey pill indistinguishable from "en attente", which is the
	 * one thing it must not look like: one has taken money and the other has
	 * not.
	 */
	public static function status_style(): void {
		echo '<style>.order-status.status-ts-acompte{background:#c8d7e1;color:#2e4453}</style>';
	}

	/** Between "en attente" and "en cours", which is where it sits in life. */
	public static function list_status( array $statuses ): array {
		$out = array();
		foreach ( $statuses as $key => $label ) {
			$out[ $key ] = $label;
			if ( 'wc-on-hold' === $key ) {
				$out[ self::STATUS ] = _x( 'Acompte reçu', 'Order status', 'teeshoop' );
			}
		}
		// If the shop has no on-hold status for some reason, it still exists.
		if ( ! isset( $out[ self::STATUS ] ) ) {
			$out[ self::STATUS ] = _x( 'Acompte reçu', 'Order status', 'teeshoop' );
		}
		return $out;
	}

	/** `payment_complete()` may run from it, which is how the balance lands. */
	public static function completable( $statuses ): array {
		$statuses   = (array) $statuses;
		$statuses[] = 'ts-acompte';
		return $statuses;
	}

	/**
	 * An order that has taken money is not editable, deposit or not.
	 *
	 * WooCommerce allows editing while an order is pending or on-hold, which is
	 * right for those. It is not right here: the customer has paid half of a
	 * total, and letting a shop manager change the lines under it would leave a
	 * deposit that no longer means 50 % of anything.
	 *
	 * @param bool      $editable
	 * @param \WC_Order $order
	 */
	public static function not_editable( $editable, $order ): bool {
		/*
		 * ANY MONEY AT ALL, not the status. A partial transfer on an order
		 * nobody authorised a deposit for leaves the order `pending`, which
		 * WooCommerce considers editable, so a shop manager could change the
		 * lines under money that has already arrived and under a facture
		 * d'acompte that has already been issued for it. The ledger is the
		 * authority here for the same reason it is the authority for what
		 * production may start.
		 */
		if ( $order instanceof \WC_Order && self::received( $order ) > 0 ) {
			return false;
		}
		return (bool) $editable;
	}

	// ── reading ──────────────────────────────────────────────────────────────

	public static function config(): array {
		$stored = get_option( OPTION_PAYMENT, array() );
		return Settlement::merge_config( is_array( $stored ) ? $stored : array() );
	}

	/** @return array<int,array{date:string,cents:int,method:string,reference:string}> */
	public static function receipts( \WC_Order $order ): array {
		return Settlement::normalise( json_decode( (string) $order->get_meta( self::META_RECEIPTS, true ), true ) );
	}

	public static function received( \WC_Order $order ): int {
		return Settlement::received( self::receipts( $order ) );
	}

	/** What the customer owes in total, in cents. */
	public static function due( \WC_Order $order ): int {
		return Money::from_eur( (string) $order->get_total() );
	}

	/** The order's own HT, which is what the deposit threshold is measured on. */
	public static function due_ht( \WC_Order $order ): int {
		return self::due( $order ) - Money::from_eur( (string) $order->get_total_tax() );
	}

	/** The deposit somebody authorised on this order, in cents, or null. */
	public static function authorised( \WC_Order $order ): ?int {
		$frozen = (string) $order->get_meta( self::META_DEPOSIT, true );
		return '' === $frozen ? null : max( 0, (int) $frozen );
	}

	public static function state( \WC_Order $order ): string {
		return Settlement::state( self::due( $order ), self::received( $order ), self::authorised( $order ), self::config() );
	}

	/**
	 * Whether the workshop may take this order to a stage.
	 *
	 * The one function session 07 has to call, and the reason this file exists.
	 *
	 * IT READS THE LEDGER, NEVER THE STATUS, and that is the safety property of
	 * the whole design. WooCommerce lets a shop manager pick any status from a
	 * dropdown, so somebody could mark an order "Acompte reçu" with no money in
	 * it at all. If production were gated on the label, that click would open
	 * the press. It is gated on the money, so the label is a convenience for
	 * scanning the order list and nothing else can ride on it.
	 */
	public static function stage_allows( \WC_Order $order, string $stage ): bool {
		return Settlement::stage_allows(
			$stage,
			self::due( $order ),
			self::received( $order ),
			self::authorised( $order ),
			self::config()
		);
	}

	// ── writing ──────────────────────────────────────────────────────────────

	/**
	 * Record money that arrived, and move the order to match.
	 *
	 * Idempotent on the reference, in `Settlement::record`. Returns whether
	 * anything was actually added, so a caller can tell "recorded" from "we had
	 * already seen this one".
	 */
	public static function record( \WC_Order $order, int $cents, string $method, string $reference ): bool {
		$before = self::receipts( $order );
		$after  = Settlement::record( $before, $cents, $method, $reference, Settings::today() );

		if ( count( $after ) === count( $before ) ) {
			return false;
		}

		$order->update_meta_data( self::META_RECEIPTS, wp_json_encode( $after ) );
		$order->save();

		/*
		 * AN ADVANCE PAYMENT OBLIGES A DOCUMENT. Article 289, I-1-c du CGI makes
		 * a facture d'acompte mandatory for money received before a supply of
		 * goods is made, and BOI-TVA-DECLA-30-20-10-10 § 120 says it applies to
		 * every acompte and not only to the ones where VAT becomes exigible.
		 *
		 * SINCE QUESTION 24 THAT OBLIGATION IS NOT DISCHARGED HERE. What this
		 * issues is a récapitulatif d'acompte, and the facture the article
		 * requires is owed by the accounting system the associate has not yet
		 * named. The document is still produced, because a customer who has paid
		 * needs something that says what for, and because it is what the
		 * accounting system will be given to invoice from.
		 *
		 * A receipt that does not clear the balance produces one; the receipt
		 * that clears it produces the closing récapitulatif instead, through
		 * `payment_complete()` below.
		 */
		if ( Settlement::remaining( self::due( $order ), self::received( $order ) ) > 0 ) {
			$document = Invoice::issue_deposit( $order, $after[ count( $after ) - 1 ] );
			if ( is_wp_error( $document ) ) {
				/*
				 * The money is banked and the document the law requires was
				 * refused. Silence here would leave an encashment with nothing
				 * to show for it and nobody knowing, which is worse than the
				 * refusal: an operator can fix a missing SIRET, they cannot fix
				 * what they were never told about.
				 */
				$order->add_order_note(
					sprintf(
						/* translators: %s: why the document was refused. */
						__( 'Encaissement enregistré mais le récapitulatif d’acompte n’a pas pu être émis : %s', 'teeshoop' ),
						$document->get_error_message()
					)
				);
			}
			$order = wc_get_order( $order->get_id() ) ?: $order;
		}

		self::follow( $order );
		return true;
	}

	/**
	 * Put the order in the status its ledger says it is in.
	 *
	 * DELIBERATELY DOES NOT FIGHT WOOCOMMERCE. When the whole total is in, the
	 * gateway's own `payment_complete()` has already moved the order to
	 * processing and this leaves it alone; the only status it ever sets itself
	 * is the one WooCommerce has no word for.
	 */
	public static function follow( \WC_Order $order ): void {
		$state = self::state( $order );

		if ( Settlement::DEPOSIT === $state && 'ts-acompte' !== $order->get_status() ) {
			$order->update_status(
				'ts-acompte',
				sprintf(
					/* translators: 1: amount received, 2: amount still owed. */
					__( 'Acompte de %1$s reçu, solde de %2$s attendu.', 'teeshoop' ),
					Money::format( self::received( $order ) ),
					Money::format( Settlement::remaining( self::due( $order ), self::received( $order ) ) )
				)
			);
			return;
		}

		if ( Settlement::PAID !== $state || $order->is_paid() ) {
			return;
		}

		/*
		 * FROM A STATUS THAT PRECEDES PAYMENT. This used to fire only for an order
		 * already at `ts-acompte`, so an order settled in one go through the box,
		 * which is every bank transfer on an order nobody authorised a deposit
		 * for, stayed `pending` for ever: never marked paid, and therefore never
		 * given the final invoice the law requires. `payment_complete` is
		 * WooCommerce's own way of saying the money is in.
		 */
		if ( in_array( $order->get_status(), array( Lifecycle::PENDING, Lifecycle::HOLD, Lifecycle::FAILED, Lifecycle::DEPOSIT ), true ) ) {
			$order->payment_complete();
			return;
		}

		/*
		 * THE BALANCE OF A DEPOSIT ORDER ALREADY UNDER WAY (CMD-01). An order can
		 * wait for artwork, be at its proof or in production with only its deposit
		 * banked. `payment_complete()` from there asked for « Payée », which the
		 * graph refuses: the guard put the status back with a « Statut refusé »
		 * note, the invoice saw an unpaid order and was not issued, and the
		 * customer was told « c'est réglé, nous préparons votre bon à tirer »
		 * about a proof they already had. The status stays where it is; the date
		 * of payment and the closing document are what the balance changes.
		 */
		if ( ! $order->get_date_paid() ) {
			$order->set_date_paid( time() );
			$order->save();
		}
		$order->add_order_note(
			sprintf(
				/* translators: %s: total received. */
				__( 'Solde reçu : la commande est réglée (%s encaissés). Son statut ne change pas.', 'teeshoop' ),
				Money::format( self::received( $order ) )
			)
		);
		$document = Invoice::issue( $order );
		if ( is_wp_error( $document ) ) {
			$order->add_order_note(
				sprintf(
					/* translators: %s: why the document was refused. */
					__( 'Le récapitulatif de commande n’a pas pu être émis : %s', 'teeshoop' ),
					$document->get_error_message()
				)
			);
		}
	}

	/**
	 * @param int    $order_id
	 * @param string $transaction_id
	 */
	public static function on_payment( $order_id, $transaction_id = '' ): void {
		$order = wc_get_order( (int) $order_id );
		if ( ! $order instanceof \WC_Order ) {
			return;
		}
		/*
		 * The gateway says the whole total is in, so the ledger records the
		 * difference between that and whatever was already there: on an ordinary
		 * order the whole thing, on one that had a deposit only the balance.
		 * The reference is the transaction id where the gateway gave one, which
		 * is what makes a retried webhook harmless.
		 */
		$missing = Settlement::remaining( self::due( $order ), self::received( $order ) );
		if ( $missing <= 0 ) {
			return;
		}
		self::record(
			$order,
			$missing,
			(string) $order->get_payment_method_title(),
			'' !== (string) $transaction_id ? (string) $transaction_id : 'wc-payment-' . $order->get_id()
		);
	}

	/**
	 * @param int       $order_id
	 * @param string    $from
	 * @param string    $to
	 * @param \WC_Order $order
	 */
	public static function on_status( $order_id, $from, $to, $order = null ): void {
		if ( ! in_array( (string) $to, wc_get_is_paid_statuses(), true ) ) {
			return;
		}
		if ( ! $order instanceof \WC_Order ) {
			$order = wc_get_order( (int) $order_id );
		}
		if ( ! $order instanceof \WC_Order ) {
			return;
		}
		/*
		 * BACS and cash on delivery never call `payment_complete()` for a
		 * non-zero order, they call `update_status()`, so a listener on the
		 * first alone never sees a bank transfer. Same reason `Invoice` watches
		 * both.
		 *
		 * BUT ONLY ON AN ORDER WITH AN EMPTY LEDGER. A status is a label a shop
		 * manager can pick from a dropdown, and this hook used to turn that pick
		 * into money: marking a half-paid order "Terminée" wrote the missing
		 * balance in as though it had arrived, which is the exact gate that has
		 * to hold the parcel. The whole design says the ledger is the authority
		 * and the status is a label; a status that can WRITE the ledger inverts
		 * that. An order that has already received something needs its balance
		 * recorded as the second event it is, with its own date and reference,
		 * through the box.
		 */
		$missing = Settlement::remaining( self::due( $order ), self::received( $order ) );
		// Nothing missing, nothing to say: a fully paid order reaching
		// « Livrée » used to be told its balance was not in (CMD-02).
		if ( $missing <= 0 ) {
			return;
		}
		if ( ! empty( self::receipts( $order ) ) ) {
			$order->add_order_note(
				__( 'Statut passé à un état payé alors que le solde n’est pas encaissé. Rien n’a été ajouté aux encaissements : enregistrez le versement pour que l’expédition s’ouvre.', 'teeshoop' )
			);
			return;
		}
		/*
		 * THE GATEWAY'S OWN REFERENCE WHEN THERE IS ONE, because the reference
		 * is what a bank statement is reconciled against and what makes a
		 * retried event harmless. `payment_complete()` sets the transaction id
		 * BEFORE it saves, and it is the save that fires this hook, so it is
		 * already there by the time we look. A status moved by hand has none,
		 * and then the fallback names the transition that caused it.
		 */
		$reference = (string) $order->get_transaction_id();
		self::record(
			$order,
			$missing,
			(string) $order->get_payment_method_title(),
			'' !== $reference ? $reference : 'wc-status-' . $order->get_id() . '-' . $to
		);
	}

	// ── what an operator sees and does ───────────────────────────────────────

	public static function meta_box(): void {
		/*
		 * BOTH SCREENS, because an order has two of them and which one is live
		 * depends on a setting. Under HPOS the order lives at
		 * `woocommerce_page_wc-orders`, on the legacy storage at `shop_order`.
		 * WooCommerce resolves it with `wc_get_page_screen_id()`, which is
		 * loaded for admin requests only: guarding on `function_exists` meant
		 * that in any other context the fallback fired and the box was
		 * registered on the screen nobody was looking at, silently. Registering
		 * on a screen that never renders costs nothing, and WordPress keys the
		 * box by id, so it cannot appear twice.
		 */
		$screens = array( 'shop_order', 'woocommerce_page_wc-orders' );
		if ( function_exists( 'wc_get_page_screen_id' ) ) {
			$screens[] = wc_get_page_screen_id( 'shop-order' );
		}

		foreach ( array_unique( $screens ) as $screen ) {
			add_meta_box(
				'teeshoop-encaissements',
				__( 'Encaissements', 'teeshoop' ),
				array( self::class, 'render_meta_box' ),
				$screen,
				'side',
				'default'
			);
		}
	}

	/** @param \WP_Post|\WC_Order $post_or_order */
	public static function render_meta_box( $post_or_order ): void {
		$order = $post_or_order instanceof \WC_Order ? $post_or_order : wc_get_order( $post_or_order->ID ?? 0 );
		if ( ! $order instanceof \WC_Order ) {
			return;
		}

		$config    = self::config();
		$due       = self::due( $order );
		$received  = self::received( $order );
		$remaining = Settlement::remaining( $due, $received );
		$state     = self::state( $order );

		echo '<p style="font-variant-numeric:tabular-nums">';
		printf(
			'%s <strong>%s</strong><br>%s <strong>%s</strong><br>%s <strong>%s</strong>',
			esc_html__( 'Dû', 'teeshoop' ),
			esc_html( Money::format( $due ) ),
			esc_html__( 'Reçu', 'teeshoop' ),
			esc_html( Money::format( $received ) ),
			esc_html__( 'Reste', 'teeshoop' ),
			esc_html( Money::format( $remaining ) )
		);
		$over = Settlement::overpaid( $due, $received );
		if ( $over > 0 ) {
			printf(
				'<br><strong>%s</strong> %s',
				esc_html__( 'Trop-perçu', 'teeshoop' ),
				esc_html( Money::format( $over ) )
			);
		}
		echo '</p>';

		echo '<p>' . esc_html( self::state_sentence( $state, $order ) ) . '</p>';

		$receipts = self::receipts( $order );
		if ( ! empty( $receipts ) ) {
			echo '<table class="widefat striped" style="margin-bottom:1em"><tbody>';
			foreach ( $receipts as $receipt ) {
				printf(
					'<tr><td>%s</td><td>%s</td><td style="text-align:right;font-variant-numeric:tabular-nums">%s</td></tr>',
					esc_html( Vat::fr_date( (string) $receipt['date'] ) ),
					esc_html( '' !== $receipt['method'] ? $receipt['method'] : $receipt['reference'] ),
					esc_html( Money::format( (int) $receipt['cents'] ) )
				);
			}
			echo '</tbody></table>';
		}

		// The deposit, which is a decision and not a rule.
		if ( ! self::authorised( $order ) && Settlement::deposit_possible( self::due_ht( $order ), $config ) && $remaining > 0 ) {
			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="margin-bottom:1em">';
			wp_nonce_field( self::ACTION_AUTHORISE . $order->get_id() );
			echo '<input type="hidden" name="action" value="' . esc_attr( self::ACTION_AUTHORISE ) . '">';
			echo '<input type="hidden" name="order_id" value="' . esc_attr( (string) $order->get_id() ) . '">';
			printf(
				'<button type="submit" class="button">%s</button>',
				esc_html(
					sprintf(
						/* translators: %s: the amount of the deposit. */
						__( 'Autoriser un acompte de %s', 'teeshoop' ),
						Money::format( Settlement::deposit_due( $due, $config ) )
					)
				)
			);
			echo '<p class="description">' . esc_html__( 'La production pourra démarrer sur l’acompte. L’expédition attendra le solde.', 'teeshoop' ) . '</p>';
			echo '</form>';
		}

		if ( $remaining > 0 ) {
			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
			wp_nonce_field( self::ACTION_RECORD . $order->get_id() );
			echo '<input type="hidden" name="action" value="' . esc_attr( self::ACTION_RECORD ) . '">';
			echo '<input type="hidden" name="order_id" value="' . esc_attr( (string) $order->get_id() ) . '">';
			echo '<p><label>' . esc_html__( 'Montant reçu', 'teeshoop' ) . '<br>';
			printf(
				'<input type="text" name="montant" inputmode="decimal" class="widefat" placeholder="%s"></label></p>',
				esc_attr( Money::number( Money::to_eur( $remaining ), 2 ) )
			);
			echo '<p><label>' . esc_html__( 'Moyen', 'teeshoop' ) . '<br>';
			echo '<input type="text" name="moyen" class="widefat" value="' . esc_attr__( 'Virement bancaire', 'teeshoop' ) . '"></label></p>';
			echo '<p><label>' . esc_html__( 'Référence', 'teeshoop' ) . '<br>';
			echo '<input type="text" name="reference" class="widefat" required></label>';
			echo '<span class="description">' . esc_html__( 'Obligatoire : le libellé du virement. C’est elle qui empêche un même versement d’être compté deux fois, donc un encaissement sans référence est refusé.', 'teeshoop' ) . '</span></p>';
			printf( '<button type="submit" class="button button-primary">%s</button>', esc_html__( 'Enregistrer l’encaissement', 'teeshoop' ) );
			echo '</form>';
		}

		/*
		 * EVERYTHING IS IN AND THE CLOSING DOCUMENT IS NOT (CMD-04). Documents are
		 * issued when money is recorded, and only then: one refused at that moment
		 * (identity incomplete, a busy lock) had no second chance, and an acompte
		 * document refused once blocked the closing one for ever. The operator
		 * fixes the cause, then asks here.
		 */
		if ( $remaining <= 0 && ! empty( $receipts ) && null === Invoice::stored( $order ) ) {
			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
			wp_nonce_field( self::ACTION_ISSUE . $order->get_id() );
			echo '<input type="hidden" name="action" value="' . esc_attr( self::ACTION_ISSUE ) . '">';
			echo '<input type="hidden" name="order_id" value="' . esc_attr( (string) $order->get_id() ) . '">';
			printf( '<button type="submit" class="button">%s</button>', esc_html__( 'Émettre les récapitulatifs manquants', 'teeshoop' ) );
			echo '<p class="description">' . esc_html__( 'La commande est réglée et son récapitulatif n’a pas été émis. Corrigez d’abord ce qui l’a empêché (le motif est affiché sous « Récapitulatif »), puis émettez-le ici.', 'teeshoop' ) . '</p>';
			echo '</form>';
		}
	}

	public static function handle_issue(): void {
		$order = self::order_from_request();
		if ( ! $order instanceof \WC_Order ) {
			wp_die( esc_html__( 'Cette commande n’existe pas.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}
		check_admin_referer( self::ACTION_ISSUE . $order->get_id() );

		$document = Invoice::issue( $order );
		if ( is_wp_error( $document ) ) {
			$order->add_order_note(
				sprintf(
					/* translators: %s: why the document was refused. */
					__( 'Le récapitulatif de commande n’a pas pu être émis : %s', 'teeshoop' ),
					$document->get_error_message()
				)
			);
		}
		wp_safe_redirect( $order->get_edit_order_url() );
		exit;
	}

	/** Where the order stands, in a sentence an operator can act on. */
	public static function state_sentence( string $state, \WC_Order $order ): string {
		switch ( $state ) {
			case Settlement::PAID:
				return __( 'Réglée. La production et l’expédition sont ouvertes.', 'teeshoop' );
			case Settlement::DEPOSIT:
				return __( 'Acompte reçu. La production peut démarrer, l’expédition attend le solde.', 'teeshoop' );
			case Settlement::SHORT:
				return self::authorised( $order )
					? __( 'Le montant reçu est inférieur à l’acompte autorisé. Rien ne démarre.', 'teeshoop' )
					: __( 'Un règlement partiel est arrivé sans qu’aucun acompte ait été autorisé. Rien ne démarre.', 'teeshoop' );
			default:
				return __( 'Rien n’a été encaissé. Rien ne démarre.', 'teeshoop' );
		}
	}

	private static function order_from_request(): ?\WC_Order {
		if ( ! current_user_can( 'edit_shop_orders' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de modifier cette commande.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- the caller checks it, and it needs this id to do so.
		$order_id = isset( $_POST['order_id'] ) ? absint( wp_unslash( $_POST['order_id'] ) ) : 0;
		$order    = $order_id > 0 ? wc_get_order( $order_id ) : null;
		return $order instanceof \WC_Order ? $order : null;
	}

	public static function handle_authorise(): void {
		$order = self::order_from_request();
		if ( ! $order instanceof \WC_Order ) {
			wp_die( esc_html__( 'Cette commande n’existe pas.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}
		check_admin_referer( self::ACTION_AUTHORISE . $order->get_id() );

		self::authorise( $order );
		wp_safe_redirect( $order->get_edit_order_url() );
		exit;
	}

	public static function handle_record(): void {
		$order = self::order_from_request();
		if ( ! $order instanceof \WC_Order ) {
			wp_die( esc_html__( 'Cette commande n’existe pas.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}
		check_admin_referer( self::ACTION_RECORD . $order->get_id() );

		// phpcs:disable WordPress.Security.NonceVerification.Missing -- checked above.
		$cents     = Money::parse_eur( sanitize_text_field( wp_unslash( (string) ( $_POST['montant'] ?? '' ) ) ) );
		$method    = sanitize_text_field( wp_unslash( (string) ( $_POST['moyen'] ?? '' ) ) );
		$reference = sanitize_text_field( wp_unslash( (string) ( $_POST['reference'] ?? '' ) ) );
		// phpcs:enable WordPress.Security.NonceVerification.Missing

		if ( '' === trim( $reference ) ) {
			wp_die(
				esc_html__( 'Un encaissement sans référence ne peut pas être enregistré : c’est la référence qui empêche de compter deux fois le même versement. Reprenez le libellé du virement.', 'teeshoop' ),
				'',
				array( 'response' => 400, 'back_link' => true )
			);
		}

		/*
		 * NOTHING RECORDED, AND THE OPERATOR IS TOLD (CMD-13). An empty amount
		 * (the grey figure in the box is a hint, not a value), « 2.736,00 » as a
		 * bank statement writes it, or a reference already on this order were
		 * all dropped by `record()`, and the page came back as if it had worked:
		 * the order stayed unpaid and production stayed blocked.
		 */
		if ( null === $cents || $cents <= 0 ) {
			wp_die(
				esc_html__( 'Montant illisible ou nul : rien n’a été enregistré. Écrivez le montant reçu, sans séparateur de milliers, par exemple 2736,00.', 'teeshoop' ),
				'',
				array( 'response' => 400, 'back_link' => true )
			);
		}
		if ( ! self::record( $order, $cents, $method, $reference ) ) {
			wp_die(
				esc_html__( 'Cette référence est déjà enregistrée sur cette commande : ce versement a déjà été compté, rien n’a été ajouté. Si c’est un second virement, reprenez son propre libellé.', 'teeshoop' ),
				'',
				array( 'response' => 409, 'back_link' => true )
			);
		}
		wp_safe_redirect( $order->get_edit_order_url() );
		exit;
	}

	/** Authorise a deposit on one order, which only a person may do. */
	public static function authorise( \WC_Order $order ): bool {
		$config = self::config();
		if ( ! Settlement::deposit_possible( self::due_ht( $order ), $config ) ) {
			return false;
		}
		// Frozen in cents, and this is what the gate reads from now on: the
		// amount somebody approved, not whatever the setting says next month.
		$order->update_meta_data( self::META_DEPOSIT, (string) Settlement::deposit_due( self::due( $order ), $config ) );
		$order->save();
		self::follow( $order );
		return true;
	}
}
