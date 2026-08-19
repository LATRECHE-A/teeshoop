<?php
/**
 * The withdrawal right, and the one case where it does not apply.
 *
 * THE LAW. Article L221-28 3° du code de la consommation excludes from the
 * fourteen-day withdrawal right « les biens confectionnés selon les
 * spécifications du consommateur ou nettement personnalisés ». A printed
 * garment made to a customer's own artwork is that, plainly. What the exclusion
 * is NOT is automatic in practice: articles L221-5 and R221-2 require the trader
 * to inform the consumer, before the contract is concluded, that the right does
 * not apply. An exclusion nobody was told about is an exclusion argued about
 * afterwards, and the customer wins.
 *
 * SO IT IS CAPTURED AT CHECKOUT, BEFORE THE ORDER EXISTS, and not only at the
 * proof. Question 18's written default records it « à la validation du bon à
 * tirer », which is after payment and therefore after the contract: that is one
 * acknowledgement too late to be the one the law asks for. Both are built. The
 * checkout one is the withdrawal right; the proof one is the approval of what
 * will be pressed (`Bat::acceptance_text`). They are different acts and each is
 * recorded where it happens.
 *
 * WHAT IS STORED IS EVIDENCE, so it is the whole thing: the instant, the
 * address, the version of the terms in force, and THE EXACT SENTENCE that was on
 * the screen. A record saying "the box was ticked" proves that a box existed. A
 * record holding the words proves what was agreed to, eighteen months later,
 * against a copy of the site nobody kept.
 *
 * ONLY WHEN THERE IS SOMETHING PERSONALISED IN THE BASKET. A blank garment off
 * the catalogue carries the ordinary withdrawal right, and asking a customer to
 * give up a right they keep is both false and, in front of the DGCCRF, an
 * unfair term.
 *
 * QUESTION 01 SAYS THE SHOP IS FOR PROFESSIONALS, where the withdrawal right
 * does not apply at all. It is built anyway: the default is not an answer, a
 * professional buying outside their main activity with fewer than six employees
 * IS a consumer for this purpose (article L221-3), and the mechanism costs one
 * checkbox.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Waiver {

	/** Order meta: the whole record, JSON. */
	public const META = '_teeshoop_renonciation';

	/** The block checkout writes under its own namespaced key. */
	private const BLOCK_KEY = '_wc_other/teeshoop/renonciation';

	/** The classic checkout's field name. */
	private const FIELD = 'teeshoop_renonciation';

	public static function init(): void {
		add_action( 'woocommerce_review_order_before_submit', array( self::class, 'classic_field' ), 20 );
		add_action( 'woocommerce_after_checkout_validation', array( self::class, 'classic_validate' ), 10, 2 );
		add_action( 'woocommerce_checkout_create_order', array( self::class, 'freeze_classic' ), 20, 1 );

		self::register_block_field();
		add_action( 'woocommerce_store_api_checkout_update_order_from_request', array( self::class, 'freeze_block' ), 20, 1 );
	}

	/**
	 * The sentence the customer agrees to.
	 *
	 * FROZEN ONTO THE ORDER, so an order taken in March is answered with March's
	 * wording. Question 18 asks the associate's lawyer to review it; the
	 * mechanism and the evidence do not wait for that, and the day the wording
	 * changes, every order already placed keeps the one it was shown.
	 */
	public static function text(): string {
		return 'Je commande des articles personnalisés à ma demande. Je sais et j’accepte '
			. 'qu’ils ne sont ni repris ni échangés, et que le droit de rétractation de '
			. 'quatorze jours ne s’y applique pas (article L221-28 du code de la '
			. 'consommation). Ce droit reste entier pour tout article non personnalisé.';
	}

	/** The label beside the box. Short, and it says what it is. */
	public static function label(): string {
		return 'J’accepte de perdre le droit de rétractation sur les articles personnalisés';
	}

	/**
	 * Whether this basket needs the acknowledgement at all.
	 *
	 * A basket with nothing personalised in it keeps the ordinary withdrawal
	 * right, and asking a customer to give up a right they keep is a term that
	 * would not survive being read.
	 */
	public static function needed( ?\WC_Cart $cart = null ): bool {
		return Cart::has_personalised( $cart );
	}

	/** The same question of an ORDER, for the invoice and the SAV screen. */
	public static function applies( \WC_Order $order ): bool {
		foreach ( $order->get_items() as $item ) {
			if ( $item instanceof \WC_Order_Item_Product && '' !== (string) $item->get_meta( '_teeshoop_design_id', true ) ) {
				return true;
			}
		}
		return false;
	}

	/** What was recorded, or null. */
	public static function record( \WC_Order $order ): ?array {
		$raw = (string) $order->get_meta( self::META, true );
		if ( '' === $raw ) {
			return null;
		}
		$row = json_decode( $raw, true );
		return is_array( $row ) ? $row : null;
	}

	// ── the classic checkout ─────────────────────────────────────────────────

	public static function classic_field(): void {
		if ( ! self::needed() ) {
			return;
		}
		printf(
			'<p class="form-row teeshoop-renonciation"><label><input type="checkbox" name="%s" value="1" required> <span>%s</span></label><span class="description" style="display:block;font-size:.85em;margin-top:.35em">%s</span></p>',
			esc_attr( self::FIELD ),
			esc_html( self::label() ),
			esc_html( self::text() )
		);
	}

	/**
	 * @param array     $data   the posted checkout fields.
	 * @param \WP_Error $errors WooCommerce's own error bag.
	 */
	public static function classic_validate( $data, $errors ): void {
		if ( ! self::needed() || ! $errors instanceof \WP_Error ) {
			return;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- WooCommerce has already verified the checkout nonce before this hook.
		if ( empty( $_POST[ self::FIELD ] ) ) {
			$errors->add(
				'teeshoop_renonciation',
				__( 'Cochez la case sur les articles personnalisés : sans elle, nous ne pouvons pas lancer la fabrication.', 'teeshoop' )
			);
		}
	}

	public static function freeze_classic( \WC_Order $order ): void {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- WooCommerce has already verified the checkout nonce before this hook.
		if ( ! empty( $_POST[ self::FIELD ] ) ) {
			self::freeze( $order );
		}
	}

	// ── the block checkout ───────────────────────────────────────────────────

	/**
	 * The same field, again, for the other checkout.
	 *
	 * REGISTERED TWICE BECAUSE WOOCOMMERCE HAS TWO CHECKOUTS, and the Store
	 * API's own registry is the only thing the block reads. `Checkout` records
	 * the same for the SIRET field: a shop that had switched to the block
	 * checkout would silently stop asking, and here that means orders with no
	 * evidence at all.
	 *
	 * NO `attributes` KEY. The block checkout is React and passes what is given
	 * here straight to the DOM; an unknown prop produces a console error on the
	 * page where money changes hands.
	 */
	private static function register_block_field(): void {
		if ( ! function_exists( 'woocommerce_register_additional_checkout_field' ) ) {
			return;
		}
		add_action(
			'woocommerce_init',
			static function (): void {
				woocommerce_register_additional_checkout_field(
					array(
						'id'       => 'teeshoop/renonciation',
						'label'    => self::label(),
						'location' => 'order',
						'type'     => 'checkbox',
						/*
						 * REQUIRED, which the block enforces itself. The classic
						 * checkout needs its own validator above because a
						 * `required` attribute is a browser hint and nothing
						 * more: a POST built by hand carries no checkbox and no
						 * browser refused it.
						 *
						 * AND IT IS REQUIRED ON EVERY BASKET, WHICH IS WRONG AND
						 * IS WRITTEN DOWN RATHER THAN PAPERED OVER. The Store
						 * API validates a registered field's `required` flag on
						 * every checkout POST, with no way to make it depend on
						 * the cart, so a basket carrying nothing personalised is
						 * asked to waive a right it keeps. The classic checkout
						 * does not have that fault (`classic_field` and
						 * `classic_validate` both ask `needed()` first).
						 *
						 * It cannot bite today: `H-Q41-CATALOGUE-CONSULTABLE`
						 * and `H-Q42-MARGE-TEXTILE-NU` mean the catalogue is
						 * browsable and not purchasable, so every basket that
						 * reaches a checkout contains a personalised line. It
						 * bites the day a blank garment can be bought, which is
						 * session 09's business, and the fix is to register the
						 * field as optional and refuse in
						 * `woocommerce_store_api_checkout_update_order_from_request`
						 * instead. Doing that now would trade a fault nothing
						 * can reach for a change nothing here can test.
						 */
						'required' => true,
					)
				);
			}
		);
	}

	public static function freeze_block( \WC_Order $order ): void {
		if ( '' !== (string) $order->get_meta( self::BLOCK_KEY, true ) ) {
			self::freeze( $order );
		}
	}

	/**
	 * Write the evidence.
	 *
	 * Idempotent on the sentinel, like `Checkout::freeze`: both checkouts can
	 * fire and an order must not end up with two records saying different times.
	 * The first one is the true one.
	 */
	public static function freeze( \WC_Order $order ): void {
		if ( '' !== (string) $order->get_meta( self::META, true ) ) {
			return;
		}
		$order->update_meta_data(
			self::META,
			wp_json_encode(
				array(
					'at'   => gmdate( 'c' ),
					// See `Bat::record_decision` for why this is REMOTE_ADDR and
					// never a forwarded header.
					'ip'   => isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '',
					'cgv'  => Legal::cgv_version(),
					'text' => self::text(),
				)
			)
		);
	}

	/**
	 * The line the invoice prints, or ''.
	 *
	 * ON THE INVOICE because that is the document the customer keeps and the
	 * accountant files. A record that lives only in the database is evidence we
	 * hold about ourselves; a line on the invoice is evidence the other side has
	 * too, which is the kind that settles an argument.
	 */
	public static function invoice_line( \WC_Order $order ): string {
		if ( ! self::applies( $order ) ) {
			return '';
		}
		$record = self::record( $order );
		if ( null === $record ) {
			/*
			 * SAYING NOTHING WOULD BE THE WRONG ANSWER. An order with a
			 * personalised line and no acknowledgement is one we cannot refuse a
			 * withdrawal on, and the invoice is where whoever handles it will be
			 * looking. It says so rather than printing a claim we cannot back.
			 */
			return 'Articles personnalisés. Aucune renonciation au droit de rétractation n’a été enregistrée pour cette commande.';
		}
		$when = strtotime( (string) $record['at'] );
		return sprintf(
			'Articles personnalisés : droit de rétractation exclu (article L221-28 du code de la consommation), accepté le %s%s.',
			$when ? ( function_exists( 'wp_date' ) ? (string) wp_date( 'd/m/Y à H:i', $when ) : gmdate( 'd/m/Y H:i', $when ) ) : (string) $record['at'],
			'' !== (string) ( $record['cgv'] ?? '' ) ? ', CGV version ' . (string) $record['cgv'] : ''
		);
	}
}
