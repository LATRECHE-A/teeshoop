<?php
/**
 * The invoice: its number, its frozen contents, and the PDF.
 *
 * ── THE NUMBER ───────────────────────────────────────────────────────────────
 *
 * CGI, annexe II, article 242 nonies A, I, 7° requires "un numéro unique basé
 * sur une séquence chronologique et continue". Continue means no holes: an
 * invoice that turns out to be wrong is cancelled by an avoir, never by
 * deleting or reusing its number. BOI-TVA-DECLA-30-20-20-10 § 90 adds that
 * uniqueness is required between two invoices issued IN THE SAME YEAR, which is
 * what licenses the ordinary French form FA2026-0001 with an annual series.
 *
 * IT IS ALLOCATED IN ONE SQL STATEMENT, and that is the only way to get it
 * right. Two customers paying in the same second are two PHP processes, and a
 * read-then-write would hand both of them the same number. MySQL's
 * `LAST_INSERT_ID(expr)` idiom increments and returns inside a single statement
 * that holds a row lock for its duration, so the value each connection reads
 * back is its own. Measured on the mirror's MariaDB 11 rather than assumed, and
 * `tests/concurrency.php` proves it with real concurrent processes.
 *
 * A REHEARSAL MUST NOT EAT REAL NUMBERS. Session 15 runs a full dress rehearsal,
 * and if its invoices came out of the shop's own series, the first real customer
 * would be handed a number continuing from a fiction. So the series carries the
 * environment: only production writes to the shop's series, and everywhere else
 * writes to a series that is not a fiscal series at all.
 *
 * ── THE DOCUMENT ─────────────────────────────────────────────────────────────
 *
 * FROZEN AT ISSUE, ENTIRELY, and this is not belt and braces. Measured on
 * WooCommerce 11.0.1: `$order->calculate_taxes()` silently reprices a placed
 * order at TODAY's rate and overwrites the `rate_percent` it had recorded, and
 * the admin's own "Recalculer" button reaches it. An invoice rendered live from
 * an order is therefore an invoice that can change after it was sent, which is
 * a ten-year compliance problem and not a bug. So the whole document, seller
 * identity included, is written to order meta the moment it is issued, and the
 * PDF is rendered from that snapshot and never from the order again.
 *
 * ONE RENDERER, NOT TWO. There is no HTML version of the invoice. A screen copy
 * and a PDF copy of the same legal document are two implementations of one rule,
 * and the day they diverge is the day a customer reads one number and the
 * accountant reads another.
 *
 * ── WHAT IT REFUSES ──────────────────────────────────────────────────────────
 *
 * No regime for the order's date, an incomplete legal identity in production, or
 * amounts that do not add up to the cent: no document. Anywhere that is not
 * production, an incomplete identity renders stamped instead, because work has
 * to be possible on a machine that is not the shop.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Invoice {

	/** Order meta. The number is the fiscal fact; the document is what was sent. */
	public const META_NUMBER = '_teeshoop_invoice_number';
	public const META_DATE   = '_teeshoop_invoice_date';
	public const META_DOC    = '_teeshoop_invoice_document';

	/** Bumped when the sequence table's shape changes. */
	private const DB_VERSION = '1';

	/**
	 * The 40 EUR recovery indemnity, fixed by article D. 441-5 du code de
	 * commerce. A legal constant and not an assumption: it is not ours to set
	 * and it does not get a register row.
	 */
	private const RECOVERY_INDEMNITY_EUR = 40;

	public static function init(): void {
		self::maybe_install();

		/*
		 * Issued when the money is in, and on both of the paths that put it
		 * there. `payment_complete` is the convention, and BACS and COD
		 * deliberately do not call it for a non-zero order: they call
		 * `update_status`. A listener on the first alone never sees a bank
		 * transfer.
		 */
		add_action( 'woocommerce_payment_complete', array( self::class, 'on_payment' ), 20, 1 );
		add_action( 'woocommerce_order_status_changed', array( self::class, 'on_status' ), 20, 4 );

		add_action( 'admin_post_teeshoop_facture', array( self::class, 'serve' ) );
		add_action( 'admin_post_nopriv_teeshoop_facture', array( self::class, 'serve' ) );

		add_action( 'woocommerce_order_details_after_order_table', array( self::class, 'customer_link' ) );
		add_action( 'woocommerce_admin_order_data_after_order_details', array( self::class, 'admin_link' ) );
	}

	// ── The sequence ─────────────────────────────────────────────────────────

	public static function table(): string {
		global $wpdb;
		return $wpdb->prefix . 'teeshoop_sequence';
	}

	public static function maybe_install(): void {
		if ( get_option( 'teeshoop_db_version' ) === self::DB_VERSION ) {
			return;
		}
		self::install();
	}

	public static function install(): void {
		global $wpdb;
		$table = self::table();

		/*
		 * `series` is the primary key and there is no auto-increment column: the
		 * number comes from `LAST_INSERT_ID(expr)`, not from a row id, so an
		 * InnoDB auto-increment gap (which a failed insert can leave) cannot
		 * become a hole in a legally continuous sequence.
		 */
		$wpdb->query(
			"CREATE TABLE IF NOT EXISTS {$table} (
				series VARCHAR(32) NOT NULL,
				next_number BIGINT UNSIGNED NOT NULL,
				PRIMARY KEY (series)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
		); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared

		update_option( 'teeshoop_db_version', self::DB_VERSION, false );
	}

	/**
	 * The next number in a series, allocated atomically.
	 *
	 * ONE STATEMENT. `LAST_INSERT_ID(next_number + 1)` sets the connection's own
	 * last-insert-id as a side effect of the UPDATE half, and `LAST_INSERT_ID(1)`
	 * does the same for the INSERT half, so both branches leave the value where
	 * `$wpdb->insert_id` reads it. Nothing between the increment and the read can
	 * interleave, because there is no between.
	 *
	 * Returns 0 when the database refused, and 0 is never issued as a number:
	 * "we could not allocate" and "the number is zero" are different results.
	 */
	public static function next_number( string $series ): int {
		global $wpdb;
		$table = self::table();

		$ok = $wpdb->query(
			$wpdb->prepare(
				"INSERT INTO {$table} (series, next_number) VALUES (%s, LAST_INSERT_ID(1))
				 ON DUPLICATE KEY UPDATE next_number = LAST_INSERT_ID(next_number + 1)",
				$series
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared

		if ( false === $ok ) {
			return 0;
		}
		return (int) $wpdb->insert_id;
	}

	/** Settings: the series prefix and the payment mentions. */
	public static function config(): array {
		$defaults = array(
			// The ordinary French form. Question 24's default gives us the
			// numbering; the letters are convention, not law.
			'prefix'       => 'FA',
			/*
			 * The late-payment interest rate, and it is EMPTY on purpose.
			 *
			 * Article L. 441-10 du code de commerce sets a default when the
			 * seller's terms name none: the ECB's latest refinancing rate plus
			 * ten points. So an empty setting is not a missing mention, it is
			 * the statutory rate, and the invoice prints the rule instead of a
			 * number nobody has verified. A contractual rate may be set here
			 * instead and may not fall below three times the legal interest
			 * rate, which for the second half of 2026 puts the floor at 8,25 %
			 * (arrêté du 26 juin 2026: 2,75 % for a professional creditor).
			 */
			'penalty_rate' => '',
		);
		$stored = get_option( OPTION_INVOICE, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}
		return array_merge( $defaults, array_intersect_key( $stored, $defaults ) );
	}

	/**
	 * The series a document issued on a date belongs to.
	 *
	 * Anywhere that is not production gets a series of its own, so a rehearsal,
	 * a preproduction test and a developer's afternoon can never consume a
	 * number a real customer's invoice would continue from. It is not a fiscal
	 * series in the BOFiP sense, because none of those documents is an invoice.
	 */
	public static function series( string $iso_date ): string {
		$year   = substr( Vat::iso_date( $iso_date ), 0, 4 );
		$prefix = (string) self::config()['prefix'];
		if ( 'production' !== Legal::environment() ) {
			$prefix = 'ESSAI';
		}
		return $prefix . $year;
	}

	/** "FA2026-0001". Four digits, then as many as it takes. */
	public static function format_number( string $series, int $n ): string {
		return $series . '-' . str_pad( (string) $n, 4, '0', STR_PAD_LEFT );
	}

	// ── Issuing ──────────────────────────────────────────────────────────────

	/** @param int $order_id */
	public static function on_payment( $order_id ): void {
		$order = wc_get_order( (int) $order_id );
		if ( $order instanceof \WC_Order ) {
			self::issue( $order );
		}
	}

	/**
	 * @param int       $order_id
	 * @param string    $from
	 * @param string    $to
	 * @param \WC_Order $order
	 */
	public static function on_status( $order_id, $from, $to, $order = null ): void {
		if ( ! in_array( (string) $to, array( 'processing', 'completed' ), true ) ) {
			return;
		}
		if ( ! $order instanceof \WC_Order ) {
			$order = wc_get_order( (int) $order_id );
		}
		if ( $order instanceof \WC_Order ) {
			self::issue( $order );
		}
	}

	/**
	 * Give an order its invoice, once.
	 *
	 * Idempotent by the presence of the number, because both hooks above can
	 * fire for the same order and a second call must not consume a second
	 * number. A hole in the sequence cannot be repaired afterwards.
	 *
	 * @return array|\WP_Error the frozen document, or why there is none.
	 */
	public static function issue( \WC_Order $order ) {
		$existing = self::stored( $order );
		if ( null !== $existing ) {
			return $existing;
		}

		$doc = self::compose( $order );
		if ( is_wp_error( $doc ) ) {
			self::log( sprintf( 'no invoice for order %d: %s', $order->get_id(), $doc->get_error_message() ) );
			return $doc;
		}

		$series = self::series( $doc['date'] );
		$n      = self::next_number( $series );
		if ( $n <= 0 ) {
			return new \WP_Error( 'teeshoop_sequence', __( 'Le numéro de facture n’a pas pu être attribué.', 'teeshoop' ) );
		}

		$doc['series'] = $series;
		$doc['number'] = self::format_number( $series, $n );

		$order->update_meta_data( self::META_NUMBER, $doc['number'] );
		$order->update_meta_data( self::META_DATE, $doc['date'] );
		$order->update_meta_data( self::META_DOC, wp_json_encode( $doc ) );
		$order->save();

		return $doc;
	}

	/** The frozen document, or null when this order has no invoice yet. */
	public static function stored( \WC_Order $order ): ?array {
		$raw = (string) $order->get_meta( self::META_DOC, true );
		if ( '' === $raw ) {
			return null;
		}
		$doc = json_decode( $raw, true );
		return is_array( $doc ) && ! empty( $doc['number'] ) ? $doc : null;
	}

	/**
	 * Build the document from the order, or refuse.
	 *
	 * EVERY AMOUNT IS RE-ADDED IN CENTS AND ASSERTED. WooCommerce keeps its
	 * totals as decimal strings and rounds where it chooses; this reads them
	 * into integers and refuses to issue a document whose lines, shipping and
	 * tax do not add up to the total the customer was charged. A one-cent
	 * disagreement between an invoice and a bank statement is an afternoon of
	 * an accountant's time, and it always turns out to have shipped months ago.
	 *
	 * @return array|\WP_Error
	 */
	public static function compose( \WC_Order $order, ?string $environment = null ) {
		$date        = self::order_date( $order );
		$environment = null === $environment ? Legal::environment() : $environment;

		/*
		 * The regime the ORDER was taken under, read from the order and not from
		 * the timeline. `Checkout::freeze` wrote it at creation; re-deriving it
		 * here would mean that changing the timeline in 2027 changes what a 2026
		 * invoice says, which is the one thing this file exists to prevent.
		 */
		$regime = (string) $order->get_meta( Checkout::META_VAT_REGIME, true );
		$rate   = (float) $order->get_meta( Checkout::META_VAT_RATE, true );
		$note   = (string) $order->get_meta( Checkout::META_VAT_NOTE, true );

		if ( '' === $regime || 'inconnu' === $regime ) {
			return new \WP_Error(
				'teeshoop_no_regime',
				__( 'Cette commande ne porte aucun régime de TVA : elle a été prise avant que le régime ne soit renseigné, ou hors de toute période connue. Aucune facture conforme ne peut en être tirée.', 'teeshoop' )
			);
		}

		$identity = Legal::identity();
		$verdict  = Legal::verdict( $identity, $regime, $environment );
		if ( Legal::REFUSE === $verdict['action'] ) {
			return new \WP_Error(
				'teeshoop_no_identity',
				sprintf(
					/* translators: %s: a list of missing legal fields. */
					__( 'L’identité légale du vendeur est incomplète (%s), donc aucune facture conforme ne peut être émise.', 'teeshoop' ),
					implode( ', ', $verdict['labels'] )
				)
			);
		}

		$lines    = array();
		$goods_ht = 0;

		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$qty      = max( 1, (int) $item->get_quantity() );
			$total_ht = Money::from_eur( (string) $item->get_total() );
			$goods_ht += $total_ht;

			$lines[] = array(
				'label'    => self::line_label( $item ),
				'detail'   => self::line_detail( $item ),
				'qty'      => $qty,
				// Derived from the line total so the column and the row agree by
				// construction. Displayed to the cent, and the total is never
				// recomputed from it.
				'unit_ht'  => Money::round( $total_ht / $qty ),
				'total_ht' => $total_ht,
				'rate'     => $rate,
			);
		}

		if ( empty( $lines ) ) {
			return new \WP_Error( 'teeshoop_no_lines', __( 'Cette commande ne contient aucune ligne à facturer.', 'teeshoop' ) );
		}

		$shipping_ht = Money::from_eur( (string) $order->get_shipping_total() );
		$discount_ht = Money::from_eur( (string) $order->get_discount_total() );
		$fees_ht     = 0;
		foreach ( $order->get_fees() as $fee ) {
			$fees_ht += Money::from_eur( (string) $fee->get_total() );
		}

		$total_tax = Money::from_eur( (string) $order->get_total_tax() );
		$total_ttc = Money::from_eur( (string) $order->get_total() );
		$total_ht  = $goods_ht + $shipping_ht + $fees_ht - $discount_ht;

		if ( $total_ht + $total_tax !== $total_ttc ) {
			return new \WP_Error(
				'teeshoop_totals',
				sprintf(
					/* translators: %d: an order number. */
					__( 'Les montants de la commande %d ne s’additionnent pas au centime près. Aucune facture n’est émise tant que ce n’est pas expliqué.', 'teeshoop' ),
					$order->get_id()
				)
			);
		}

		/*
		 * Under franchise NOTHING about VAT may appear beyond the mention.
		 * BOFiP BOI-TVA-DECLA-30-20-20-10 § 460: showing VAT on an invoice makes
		 * the issuer liable for it by the sole fact of having invoiced it, and
		 * the customer still cannot deduct it. So there is no rate column, no
		 * VAT line, and no TTC total distinct from the HT one.
		 */
		$franchise = Vat::FRANCHISE === $regime;
		if ( $franchise && ( 0 !== $total_tax || $total_ht !== $total_ttc ) ) {
			return new \WP_Error(
				'teeshoop_franchise_vat',
				__( 'Cette commande porte de la TVA alors qu’elle a été prise sous le régime de la franchise en base. Rien ne peut être facturé tant que ce n’est pas corrigé.', 'teeshoop' )
			);
		}

		$config = self::config();

		return array(
			'number'      => '',
			'series'      => '',
			'date'        => $date,
			'order'       => array(
				'number' => (string) $order->get_order_number(),
				'date'   => $order->get_date_created() ? $order->get_date_created()->date( 'Y-m-d' ) : $date,
				'paid'   => $order->get_date_paid() ? $order->get_date_paid()->date( 'Y-m-d' ) : '',
				'method' => (string) $order->get_payment_method_title(),
			),
			'seller'      => $identity,
			'buyer'       => self::buyer( $order ),
			'shipping_to' => self::shipping_address( $order ),
			'regime'      => $regime,
			'rate'        => $rate,
			'mention'     => $note,
			'lines'       => $lines,
			'shipping_ht' => $shipping_ht,
			'discount_ht' => $discount_ht,
			'fees_ht'     => $fees_ht,
			'total_ht'    => $total_ht,
			'total_vat'   => $total_tax,
			'total_ttc'   => $total_ttc,
			'terms'       => array(
				'penalty_rate' => (string) $config['penalty_rate'],
				'indemnity'    => self::RECOVERY_INDEMNITY_EUR,
			),
			// Carried so the renderer never has to ask the environment again: a
			// document issued stamped stays stamped in its own record.
			'stamp'       => Legal::STAMP === $verdict['action'] ? Legal::STAMP_TEXT : '',
			'missing'     => $verdict['labels'],
		);
	}

	/** The order's own date, in the shop's timezone, as ISO. */
	private static function order_date( \WC_Order $order ): string {
		$created = $order->get_date_created();
		return $created ? $created->date( 'Y-m-d' ) : Settings::today();
	}

	private static function line_label( \WC_Order_Item_Product $item ): string {
		return (string) $item->get_name();
	}

	/**
	 * The precise designation the law asks for, from what the line already
	 * carries: which faces are printed, which sizes, which design.
	 *
	 * "Dénomination précise" (242 nonies A, I, 8°) on a personalised garment is
	 * not the product's title. Two orders of "Tee de vérification" that differ
	 * by their printed faces are two different goods, and eighteen months from
	 * now the invoice is the only place that says which was which.
	 */
	private static function line_detail( \WC_Order_Item_Product $item ): string {
		$bits = array();
		foreach ( array( 'Faces imprimées', 'Tailles' ) as $key ) {
			$value = (string) $item->get_meta( $key, true );
			if ( '' !== $value ) {
				$bits[] = $value;
			}
		}
		$design = (string) $item->get_meta( '_teeshoop_design_id', true );
		if ( '' !== $design ) {
			$bits[] = sprintf(
				/* translators: %s: a design identifier. */
				__( 'création %s', 'teeshoop' ),
				$design
			);
		}
		return implode( ' · ', $bits );
	}

	private static function buyer( \WC_Order $order ): array {
		return array(
			'company'  => (string) $order->get_billing_company(),
			'name'     => trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ),
			'address'  => trim( $order->get_billing_address_1() . ' ' . $order->get_billing_address_2() ),
			'postcode' => (string) $order->get_billing_postcode(),
			'city'     => (string) $order->get_billing_city(),
			'country'  => (string) $order->get_billing_country(),
			// Question 01's default asks for it and does not block on it, so it
			// is printed when the buyer gave it and absent when they did not.
			'siret'    => Legal::siret( (string) $order->get_meta( '_billing_siret', true ) ),
		);
	}

	/**
	 * The delivery address, but only when it differs from the billing one.
	 *
	 * Article 242 nonies A, I, 7° bis wants it on the invoice exactly then, and
	 * printing it always would put the same block on the page twice.
	 */
	private static function shipping_address( \WC_Order $order ): array {
		$ship = array(
			'name'     => trim( $order->get_shipping_first_name() . ' ' . $order->get_shipping_last_name() ),
			'company'  => (string) $order->get_shipping_company(),
			'address'  => trim( $order->get_shipping_address_1() . ' ' . $order->get_shipping_address_2() ),
			'postcode' => (string) $order->get_shipping_postcode(),
			'city'     => (string) $order->get_shipping_city(),
			'country'  => (string) $order->get_shipping_country(),
		);
		if ( '' === $ship['address'] . $ship['postcode'] . $ship['city'] ) {
			return array();
		}
		$bill = self::buyer( $order );
		$same = $ship['address'] === $bill['address']
			&& $ship['postcode'] === $bill['postcode']
			&& $ship['city'] === $bill['city'];
		return $same ? array() : $ship;
	}

	// ── The PDF ──────────────────────────────────────────────────────────────

	/**
	 * The document, on A4.
	 *
	 * Laid out in millimetres from the top left, because that is how a page is
	 * read and how a printer is set up. The column positions are the RIGHT edge
	 * of each numeric column, so every figure aligns on its units digit: prices
	 * in a column that do not line up are the fastest way to look like a
	 * generated invoice, and Helvetica's digits are all one width, so it costs
	 * nothing to get right.
	 */
	public static function pdf( array $doc ): string {
		$pdf = new Pdf();

		$left      = 18.0;
		$right     = 192.0;
		$franchise = Vat::FRANCHISE === ( $doc['regime'] ?? '' );

		// Numeric columns, right edges. Without a rate column there is more room
		// for the two that carry money.
		$col_qty   = $franchise ? 130.0 : 122.0;
		$col_unit  = $franchise ? 160.0 : 148.0;
		$col_rate  = 168.0;
		$col_total = $right;

		$y = self::pdf_header( $pdf, $doc, $left, $right );

		// ── the table ────────────────────────────────────────────────────────
		$pdf->fill( $left, $y - 4.5, $right - $left, 6.5, 0.94 );
		$pdf->text( $left + 1.5, $y, __( 'Désignation', 'teeshoop' ), Pdf::BOLD, 8.5 );
		$pdf->text_right( $col_qty, $y, __( 'Qté', 'teeshoop' ), Pdf::BOLD, 8.5 );
		$pdf->text_right( $col_unit, $y, __( 'PU HT', 'teeshoop' ), Pdf::BOLD, 8.5 );
		if ( ! $franchise ) {
			$pdf->text_right( $col_rate, $y, __( 'TVA', 'teeshoop' ), Pdf::BOLD, 8.5 );
		}
		$pdf->text_right( $col_total, $y, __( 'Total HT', 'teeshoop' ), Pdf::BOLD, 8.5 );
		$y += 8;

		$label_width = $col_qty - $left - 6;

		foreach ( (array) $doc['lines'] as $line ) {
			if ( $y > 232 ) {
				$pdf->page_break();
				$y = 24;
			}
			$pdf->text( $left, $y, Pdf::fit( (string) $line['label'], $label_width, Pdf::REGULAR, 9.5 ), Pdf::REGULAR, 9.5 );
			$pdf->text_right( $col_qty, $y, Money::number( (float) $line['qty'], 0 ) );
			$pdf->text_right( $col_unit, $y, Money::format( (int) $line['unit_ht'] ) );
			if ( ! $franchise ) {
				$pdf->text_right( $col_rate, $y, Money::number( (float) $line['rate'] * 100, 0 ) . ' %' );
			}
			$pdf->text_right( $col_total, $y, Money::format( (int) $line['total_ht'] ) );

			if ( '' !== (string) $line['detail'] ) {
				$y += 4.2;
				$pdf->text( $left, $y, Pdf::fit( (string) $line['detail'], $label_width, Pdf::REGULAR, 7.8 ), Pdf::REGULAR, 7.8, 0.35 );
			}
			$y += 6.5;
		}

		if ( 0 !== (int) $doc['shipping_ht'] ) {
			$pdf->text( $left, $y, __( 'Livraison', 'teeshoop' ) );
			if ( ! $franchise ) {
				$pdf->text_right( $col_rate, $y, Money::number( (float) $doc['rate'] * 100, 0 ) . ' %' );
			}
			$pdf->text_right( $col_total, $y, Money::format( (int) $doc['shipping_ht'] ) );
			$y += 6.5;
		}
		if ( 0 !== (int) $doc['discount_ht'] ) {
			// 9° of article 242 nonies A: a discount acquired at the time of the
			// operation is a mandatory line of its own, not a lower unit price.
			$pdf->text( $left, $y, __( 'Remise', 'teeshoop' ) );
			$pdf->text_right( $col_total, $y, Money::format( -(int) $doc['discount_ht'] ) );
			$y += 6.5;
		}

		$y += 2;
		$pdf->rule( $left, $y, $right );
		$y += 7;

		// ── the totals ───────────────────────────────────────────────────────
		$totals_label = $col_unit;
		if ( $franchise ) {
			/*
			 * ONE LINE, and no TTC beside it. Under the franchise there is no
			 * tax to state and HT equals TTC; printing both columns would invite
			 * the reader to look for a VAT line that must not exist.
			 */
			$pdf->text_right( $totals_label, $y, __( 'Total à payer', 'teeshoop' ), Pdf::BOLD, 10.5 );
			$pdf->text_right( $col_total, $y, Money::format( (int) $doc['total_ttc'] ), Pdf::BOLD, 10.5 );
			$y += 9;
		} else {
			$pdf->text_right( $totals_label, $y, __( 'Total HT', 'teeshoop' ) );
			$pdf->text_right( $col_total, $y, Money::format( (int) $doc['total_ht'] ) );
			$y += 5.5;
			$pdf->text_right(
				$totals_label,
				$y,
				sprintf(
					/* translators: %s: a VAT rate, already formatted. */
					__( 'TVA %s', 'teeshoop' ),
					Money::number( (float) $doc['rate'] * 100, 0 ) . ' %'
				)
			);
			$pdf->text_right( $col_total, $y, Money::format( (int) $doc['total_vat'] ) );
			$y += 6.5;
			$pdf->text_right( $totals_label, $y, __( 'Total TTC', 'teeshoop' ), Pdf::BOLD, 10.5 );
			$pdf->text_right( $col_total, $y, Money::format( (int) $doc['total_ttc'] ), Pdf::BOLD, 10.5 );
			$y += 9;
		}

		// ── the mentions ─────────────────────────────────────────────────────
		/*
		 * WRAPPED, NOT TRUNCATED, and the block is placed from its own height.
		 * The first version pinned the block at 246 mm and cut every line at the
		 * margin, which put an ellipsis in the middle of two mentions article
		 * L. 441-9 makes mandatory. A mandatory mention that does not fit moves
		 * the block up; it never loses its second half.
		 */
		$wrapped = array();
		foreach ( self::mentions( $doc ) as $mention ) {
			foreach ( Pdf::wrap( $mention, $right - $left, Pdf::REGULAR, 7.2 ) as $line ) {
				$wrapped[] = $line;
			}
		}

		$foot = 288.0 - count( $wrapped ) * 3.6;
		$y    = max( $y + 6, min( 246.0, $foot ) );
		$pdf->rule( $left, $y - 4, $right, 0.15, 0.82 );

		foreach ( $wrapped as $line ) {
			$pdf->text( $left, $y, $line, Pdf::REGULAR, 7.2, 0.25 );
			$y += 3.6;
		}

		if ( '' !== (string) $doc['stamp'] ) {
			$pdf->stamp( (string) $doc['stamp'] );
		}

		return $pdf->render(
			sprintf(
				/* translators: %s: an invoice number. */
				__( 'Facture %s', 'teeshoop' ),
				(string) $doc['number']
			),
			self::pdf_date( (string) $doc['date'] )
		);
	}

	/** The two identity blocks and the title. Returns the y to carry on from. */
	private static function pdf_header( Pdf $pdf, array $doc, float $left, float $right ): float {
		$seller = (array) $doc['seller'];

		$y = 22.0;
		$pdf->text( $left, $y, (string) ( $seller['raison_sociale'] ?? '' ), Pdf::BOLD, 12 );
		$y += 5;

		$forme = trim( (string) ( $seller['forme_juridique'] ?? '' ) );
		if ( '' !== (string) ( $seller['capital'] ?? '' ) ) {
			$forme = trim( $forme . ' ' . sprintf(
				/* translators: %s: an amount of share capital, as the operator typed it. */
				__( 'au capital de %s', 'teeshoop' ),
				(string) $seller['capital']
			) );
		}
		foreach ( array(
			$forme,
			(string) ( $seller['adresse'] ?? '' ),
			trim( ( $seller['code_postal'] ?? '' ) . ' ' . ( $seller['ville'] ?? '' ) ),
		) as $bit ) {
			if ( '' !== trim( $bit ) ) {
				$pdf->text( $left, $y, $bit, Pdf::REGULAR, 8.5 );
				$y += 4;
			}
		}

		$siret = (string) ( $seller['siret'] ?? '' );
		if ( '' !== $siret ) {
			$pdf->text( $left, $y, __( 'SIRET', 'teeshoop' ) . ' ' . Legal::format_siret( $siret ), Pdf::REGULAR, 8.5 );
			$y += 4;
		}
		// R. 123-237 du code de commerce: the RCS mention is the letters, then
		// the town of the registry, and the number is the SIREN.
		if ( '' !== (string) ( $seller['rcs_ville'] ?? '' ) ) {
			$pdf->text(
				$left,
				$y,
				'RCS ' . $seller['rcs_ville'] . ' ' . trim( implode( "\u{00A0}", str_split( Legal::siren( $siret ), 3 ) ) ),
				Pdf::REGULAR,
				8.5
			);
			$y += 4;
		}
		if ( '' !== (string) ( $seller['tva_intra'] ?? '' ) ) {
			$pdf->text( $left, $y, __( 'TVA', 'teeshoop' ) . ' ' . $seller['tva_intra'], Pdf::REGULAR, 8.5 );
			$y += 4;
		}

		// The title block, right, level with the top of the seller block.
		$pdf->text_right( $right, 24, __( 'FACTURE', 'teeshoop' ), Pdf::BOLD, 20 );
		$pdf->text_right( $right, 31, (string) $doc['number'], Pdf::BOLD, 11 );
		$pdf->text_right( $right, 37, Vat::fr_date( (string) $doc['date'] ), Pdf::REGULAR, 9 );

		// The buyer, right, where a window envelope shows it.
		$buyer = (array) $doc['buyer'];
		$by    = max( $y + 10, 58.0 );
		foreach ( array(
			(string) ( $buyer['company'] ?? '' ),
			(string) ( $buyer['name'] ?? '' ),
			(string) ( $buyer['address'] ?? '' ),
			trim( ( $buyer['postcode'] ?? '' ) . ' ' . ( $buyer['city'] ?? '' ) ),
		) as $index => $bit ) {
			if ( '' === trim( $bit ) ) {
				continue;
			}
			$pdf->text( 118, $by, Pdf::fit( $bit, $right - 118, 0 === $index ? Pdf::BOLD : Pdf::REGULAR, 9.5 ), 0 === $index ? Pdf::BOLD : Pdf::REGULAR, 9.5 );
			$by += 4.6;
		}
		if ( '' !== (string) ( $buyer['siret'] ?? '' ) ) {
			$pdf->text( 118, $by, __( 'SIRET', 'teeshoop' ) . ' ' . Legal::format_siret( (string) $buyer['siret'] ), Pdf::REGULAR, 8 );
			$by += 4.6;
		}

		$y = max( $y, $by ) + 8;

		$order = (array) $doc['order'];
		$pdf->text(
			$left,
			$y,
			sprintf(
				/* translators: 1: an order number, 2: a date. */
				__( 'Commande %1$s du %2$s', 'teeshoop' ),
				(string) $order['number'],
				Vat::fr_date( (string) $order['date'] )
			),
			Pdf::REGULAR,
			9
		);
		$y += 5;

		$ship = (array) $doc['shipping_to'];
		if ( ! empty( $ship ) ) {
			$pdf->text(
				$left,
				$y,
				__( 'Livraison', 'teeshoop' ) . ' : ' . trim( $ship['address'] . ', ' . $ship['postcode'] . ' ' . $ship['city'] ),
				Pdf::REGULAR,
				8.5,
				0.3
			);
			$y += 5;
		}

		return $y + 6;
	}

	/**
	 * Everything the law makes us write at the bottom of the page.
	 *
	 * Assembled here rather than in the layout so the list can be read as a list
	 * and checked against the articles it comes from.
	 *
	 * @return string[]
	 */
	public static function mentions( array $doc ): array {
		$out       = array();
		$franchise = Vat::FRANCHISE === ( $doc['regime'] ?? '' );

		if ( '' !== (string) $doc['mention'] ) {
			// CGI art. 293 E, II. Mandatory and not decorative: an invoice under
			// the franchise that does not carry it is non-conforming.
			$out[] = (string) $doc['mention'];
		}

		// 8° bis of article 242 nonies A. This shop sells garments; the printing
		// is part of the good, not a separate service.
		$out[] = __( 'Opérations : livraisons de biens.', 'teeshoop' );

		$order = (array) $doc['order'];
		if ( '' !== (string) $order['paid'] ) {
			$out[] = sprintf(
				/* translators: 1: a date, 2: a payment method. */
				__( 'Règlement à la commande. Facture payée le %1$s par %2$s.', 'teeshoop' ),
				Vat::fr_date( (string) $order['paid'] ),
				'' !== (string) $order['method'] ? (string) $order['method'] : __( 'paiement en ligne', 'teeshoop' )
			);
		} else {
			$out[] = __( 'Règlement à la commande, à réception de la présente facture.', 'teeshoop' );
		}

		/*
		 * L. 441-9 du code de commerce: a professional invoice must carry the
		 * escompte conditions, the late-payment rate and the recovery indemnity.
		 *
		 * The rate is printed as the RULE and not as a number when nobody has
		 * set one, because that is exactly what the law says applies by default
		 * (L. 441-10, II). Inventing a percentage here would be inventing a
		 * figure the customer is bound by.
		 */
		$terms = (array) $doc['terms'];
		$out[] = __( 'Escompte pour paiement anticipé : néant.', 'teeshoop' );
		$out[] = '' !== (string) $terms['penalty_rate']
			? sprintf(
				/* translators: %s: an annual interest rate, as the operator typed it. */
				__( 'Pénalités de retard exigibles le jour suivant la date de règlement, sans rappel, au taux de %s l’an.', 'teeshoop' ),
				(string) $terms['penalty_rate']
			)
			: __( 'Pénalités de retard exigibles le jour suivant la date de règlement, sans rappel, au taux appliqué par la Banque centrale européenne à son opération de refinancement la plus récente majoré de 10 points de pourcentage.', 'teeshoop' );
		$out[] = sprintf(
			/* translators: %s: an amount in euros. */
			__( 'Indemnité forfaitaire pour frais de recouvrement : %s (articles L. 441-10 et D. 441-5 du code de commerce). Une indemnisation complémentaire peut être demandée sur justification.', 'teeshoop' ),
			Money::format( (int) $terms['indemnity'] * 100 )
		);

		if ( ! $franchise && '' === (string) ( $doc['seller']['tva_intra'] ?? '' ) ) {
			$out[] = __( 'Numéro de TVA intracommunautaire manquant.', 'teeshoop' );
		}

		if ( '' !== (string) $doc['stamp'] ) {
			$out[] = sprintf(
				/* translators: %s: a list of missing legal fields. */
				__( 'Document non conforme, inutilisable comme facture : %s manque à l’identité du vendeur.', 'teeshoop' ),
				implode( ', ', (array) $doc['missing'] )
			);
		}

		return $out;
	}

	/** "D:20260818120000+00'00'", which is how a PDF writes a date. */
	private static function pdf_date( string $iso ): string {
		$iso = Vat::iso_date( $iso );
		return 'D:' . ( '' === $iso ? '19700101' : str_replace( '-', '', $iso ) ) . "000000+00'00'";
	}

	// ── Handing it over ──────────────────────────────────────────────────────

	/** The URL that downloads an order's invoice. */
	public static function url( \WC_Order $order ): string {
		return add_query_arg(
			array(
				'action'   => 'teeshoop_facture',
				'order_id' => $order->get_id(),
				'key'      => $order->get_order_key(),
			),
			admin_url( 'admin-post.php' )
		);
	}

	/**
	 * Stream the PDF.
	 *
	 * THE ORDER KEY IS THE CAPABILITY, and it is WooCommerce's own: the same
	 * secret guards the order-received page and the "voir la commande" link in
	 * every transactional e-mail. A customer who is not logged in still has to
	 * be able to fetch their invoice, so there is no session to check; what
	 * there is instead is a per-order unguessable token, compared in constant
	 * time, and never a comparison on the order id alone.
	 *
	 * A shop manager gets it without the key, because they can already read the
	 * order.
	 */
	public static function serve(): void {
		$order_id = isset( $_GET['order_id'] ) ? absint( wp_unslash( $_GET['order_id'] ) ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$key      = isset( $_GET['key'] ) ? sanitize_text_field( wp_unslash( $_GET['key'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		$order = $order_id > 0 ? wc_get_order( $order_id ) : null;
		if ( ! $order instanceof \WC_Order ) {
			wp_die( esc_html__( 'Cette facture n’existe pas.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}

		$allowed = current_user_can( 'edit_shop_orders' )
			|| ( '' !== $key && hash_equals( (string) $order->get_order_key(), $key ) );
		if ( ! $allowed ) {
			// The same answer as a missing order, on purpose: a different one
			// would confirm that the order number exists.
			wp_die( esc_html__( 'Cette facture n’existe pas.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}

		$doc = self::stored( $order );
		if ( null === $doc ) {
			$doc = self::issue( $order );
		}
		if ( is_wp_error( $doc ) ) {
			wp_die( esc_html( $doc->get_error_message() ), '', array( 'response' => 409 ) );
		}

		$pdf = self::pdf( $doc );

		nocache_headers();
		header( 'Content-Type: application/pdf' );
		header( 'Content-Length: ' . strlen( $pdf ) );
		header( 'Content-Disposition: attachment; filename="' . sanitize_file_name( $doc['number'] ) . '.pdf"' );
		echo $pdf; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- binary PDF.
		exit;
	}

	/** The link a customer sees under their order. */
	public static function customer_link( \WC_Order $order ): void {
		if ( null === self::stored( $order ) ) {
			return;
		}
		printf(
			'<p class="teeshoop-facture"><a href="%s">%s</a></p>',
			esc_url( self::url( $order ) ),
			esc_html__( 'Télécharger la facture (PDF)', 'teeshoop' )
		);
	}

	/** And the one an operator sees, with the reason when there is none. */
	public static function admin_link( \WC_Order $order ): void {
		$doc = self::stored( $order );
		if ( null !== $doc ) {
			printf(
				'<p class="form-field form-field-wide"><strong>%s</strong> %s (<a href="%s">%s</a>)</p>',
				esc_html__( 'Facture', 'teeshoop' ),
				esc_html( (string) $doc['number'] ),
				esc_url( self::url( $order ) ),
				esc_html__( 'télécharger le PDF', 'teeshoop' )
			);
			return;
		}

		$why = self::compose( $order );
		printf(
			'<p class="form-field form-field-wide"><strong>%s</strong> %s</p>',
			esc_html__( 'Facture', 'teeshoop' ),
			esc_html(
				is_wp_error( $why )
					? $why->get_error_message()
					: __( 'pas encore émise : elle le sera à l’encaissement.', 'teeshoop' )
			)
		);
	}

	private static function log( string $message ): void {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( '[teeshoop] ' . $message ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		}
	}
}
