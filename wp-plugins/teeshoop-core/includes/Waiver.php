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

	/**
	 * The classic checkout's half.
	 *
	 * `applies()` IS ASKED HERE TOO, and it was not. `classic_field()` and
	 * `classic_validate()` both ask `needed()` of the CART, which is right for
	 * deciding whether to show the box and whether to refuse without it. This
	 * hook decides whether to WRITE EVIDENCE, and evidence is about the order.
	 *
	 * The two can disagree: a basket that held a personalised item when the page
	 * rendered, emptied of it in another tab before the POST, still carries the
	 * ticked field. `needed()` is then false so nothing objects, and this wrote a
	 * waiver saying the customer gave up a right they in fact kept, with their IP
	 * and the exact sentence, on an order of blank garments. The block path got
	 * this guard in the same session; the classic one had not.
	 */
	public static function freeze_classic( \WC_Order $order ): void {
		if ( ! self::applies( $order ) ) {
			return;
		}
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
						'id'            => 'teeshoop/renonciation',
						/*
						 * THE WHOLE SENTENCE, BECAUSE THE WHOLE SENTENCE IS WHAT
						 * GETS FROZEN.
						 *
						 * `freeze()` records `text()` as « the exact sentence that
						 * was on the screen », and on the block checkout it was
						 * not: the block renders a field's `label` and nothing
						 * else, so the customer read the short label while the
						 * evidence claimed forty words they had never seen. The
						 * classic checkout prints the label AND the sentence,
						 * which is where the claim came from. One sentence, shown
						 * and recorded, on both.
						 *
						 * AND `optionalLabel`, WHICH IS NOT DECORATION.
						 * WooCommerce appends « (facultatif) » to the label of any
						 * field whose `required` is false, and this one's is false
						 * because the requirement depends on the basket and is
						 * enforced in `freeze_block` instead. Measured on the
						 * mirror: the box read « … sur les articles personnalisés
						 * (facultatif) » while the server refused the order
						 * without it. Telling a consumer that giving up a right is
						 * optional and then refusing their order is worse than
						 * either half.
						 */
						'label'         => self::text(),
						'optionalLabel' => self::text(),
						'location'      => 'order',
						'type'          => 'checkbox',
						/*
						 * OPTIONAL HERE, AND REFUSED IN `freeze_block` INSTEAD.
						 *
						 * This was `true`, with a comment saying the fault it
						 * caused could not bite because the catalogue is
						 * browsable and not purchasable. THAT CLAIM WAS FALSE
						 * when it was checked: on the mirror, product 10
						 * « T-shirt personnalisable » is published, visible,
						 * priced, `is_purchasable()` true, carries no
						 * `_teeshoop_*` meta, and
						 * `woocommerce_add_to_cart_validation` lets it through.
						 * So `?add-to-cart=10` reaches the block checkout with a
						 * basket carrying nothing personalised, and the customer
						 * is made to waive a right they keep before they can pay,
						 * which is an unfair term.
						 *
						 * The register itself said so: H-Q42-MARGE-TEXTILE-NU's
						 * own `derives` field reads « la phrase devient fausse le
						 * jour où le taux est posé ». A safety property that
						 * depends on nobody having left a priced product
						 * published is not a safety property.
						 *
						 * WooCommerce 11.0.1 does offer a conditional `required`
						 * (an array of rules instead of `true`), and it is NOT
						 * usable here: the rules are only evaluated when the
						 * `experimental-blocks` feature is on, which it is not,
						 * and its DocumentObject exposes item counts and totals
						 * rather than per-item design meta. Registered optional,
						 * it would simply never enforce anything.
						 *
						 * So the refusal is server side, on the order, where the
						 * lines are, and it throws a `RouteException` that
						 * WooCommerce turns into a 400. The order stays a
						 * `checkout-draft` and is never paid.
						 */
						'required' => false,
					)
				);
			}
		);
	}

	/**
	 * The block checkout's half: refuse, or record.
	 *
	 * `'1' === …` AND NOT `'' !== …`, WHICH IS THE HIGHEST-SEVERITY FIX IN THIS
	 * FILE. WooCommerce stores an unticked additional-field checkbox as the
	 * STRING '0', not as an empty value: « Convert boolean values to strings
	 * because Data Stores will skip false values » (CheckoutFields.php), and its
	 * own reader casts it back with `'1' === $value`. Ours asked whether the meta
	 * was non-empty, and '0' is not empty. While the field was `required` the
	 * schema pinned it to `enum [true]` and nothing could reach the bug; the
	 * moment the field became optional, which is the change above and the change
	 * the previous comment in this file recommended, an unticked box would have
	 * frozen a record asserting that the customer accepted, with the exact
	 * sentence and their IP address. Fabricated evidence, written by us, in the
	 * one record whose whole purpose is to be believed.
	 *
	 * @throws \Automattic\WooCommerce\StoreApi\Exceptions\RouteException When a
	 *         personalised basket has not been acknowledged.
	 */
	public static function freeze_block( \WC_Order $order ): void {
		$ticked = '1' === (string) $order->get_meta( self::BLOCK_KEY, true );

		/*
		 * NOTHING PERSONALISED, NOTHING TO WAIVE, AND NO RECORD EITHER. This used
		 * to write a waiver on any basket whose field was non-empty, including
		 * one carrying only blank garments: `invoice_line()` then printed nothing
		 * because `applies()` is false, so the row sat in the order meta,
		 * invisible to everyone, asserting that a customer had given up a right
		 * they in fact kept.
		 *
		 * `applies()` reads the ORDER's line items rather than the cart, and they
		 * exist by now: WooCommerce's own docblock on this hook says it is
		 * « called only with a real, persisted order », created from the cart at
		 * its first save-point.
		 */
		if ( ! self::applies( $order ) ) {
			/*
			 * AND AN EXISTING RECORD GOES WITH IT, which is not the same thing as
			 * not writing one.
			 *
			 * The Store API keeps ONE checkout-draft order in the session and
			 * mutates it on every cart and checkout call; its own docblock says a
			 * pending or failed order from a previous payment attempt is reused.
			 * So: personalised line, box ticked, record frozen. Payment fails.
			 * The customer goes back, replaces the item with a blank garment and
			 * pays. `freeze()` is idempotent on its sentinel, so the record from
			 * the first attempt survived on an order that no longer has anything
			 * personalised in it, invisible to `invoice_line()` because
			 * `applies()` is false, and reported to the customer by the article 15
			 * export as a right they gave up. Measured on the mirror.
			 */
			$order->delete_meta_data( self::META );
			return;
		}

		if ( ! $ticked ) {
			throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException(
				'teeshoop_renonciation_requise',
				esc_html__( 'Cochez la case sur les articles personnalisés : sans elle, nous ne pouvons pas lancer la fabrication.', 'teeshoop' ),
				400
			);
		}

		self::freeze( $order );
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
