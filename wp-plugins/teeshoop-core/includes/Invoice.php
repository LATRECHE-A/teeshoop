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

/*
 * THE TEST ESCAPE. `Invoice::default_config()` holds the late-payment rate,
 * which the conditions of sale promise is NOT set, and `tests/test-terms.php`
 * has to read it to check that promise. Nothing here touches WordPress at load
 * time: the hypotheses guard already `require_once`s every file in this
 * directory in a bare PHP process, which is the proof.
 *
 * Without it, a pure test requiring this file hits `exit` at load, the runner
 * ends with no summary, and only the shutdown sentinel added this session tells
 * anybody that half the suite did not run.
 */
defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Invoice {

	/** Order meta. The number is the fiscal fact; the document is what was sent. */
	public const META_NUMBER = '_teeshoop_invoice_number';
	public const META_DATE   = '_teeshoop_invoice_date';
	public const META_DOC    = '_teeshoop_invoice_document';

	/**
	 * Every document this order has produced, in the order it produced them.
	 *
	 * A list rather than a field, because an order settled in two payments
	 * produces two invoices and both are numbered: article 289, I-1-c du CGI
	 * makes a facture d'acompte mandatory on receipt of an advance payment for
	 * a supply of goods, and BOI-TVA-DECLA-30-20-20-10 § 60 requires the final
	 * one to reference them.
	 */
	public const META_DOCS = '_teeshoop_factures';

	/** The kinds of document this issues. Both are factures in the law's sense. */
	public const KIND_INVOICE = 'facture';
	public const KIND_DEPOSIT = 'acompte';

	/** How many characters of the document could not be written to a PDF. */
	public const META_LOST = '_teeshoop_invoice_lost';

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

	/**
	 * The shipped invoice settings.
	 *
	 * Separate from `config()` and calling no WordPress function, so the
	 * register's guard can read the values it has a row for: it loads every
	 * class in `includes/` in a bare PHP process, and a default that lives
	 * inside a `get_option()` call has no home the guard can resolve.
	 */
	public static function default_config(): array {
		return array(
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
	}

	/** The stored settings merged over the shipped ones. */
	public static function config(): array {
		$defaults = self::default_config();
		$stored   = get_option( OPTION_INVOICE, array() );
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

		/*
		 * NOTHING IS INVOICED THAT HAS NOT BEEN PAID.
		 *
		 * A sale that did not happen has no invoice, and the number it would
		 * consume cannot be given back. `is_paid()` is WooCommerce's own answer
		 * (processing or completed, plus whatever a plugin adds to
		 * `wc_get_is_paid_statuses`), which is the same definition the shop's
		 * reports use, so this cannot drift away from what an operator sees.
		 */
		if ( ! $order->is_paid() ) {
			return new \WP_Error(
				'teeshoop_not_paid',
				__( 'Cette commande n’est pas réglée : rien n’est facturé tant qu’elle ne l’est pas.', 'teeshoop' )
			);
		}

		$doc = self::compose( $order );
		if ( is_wp_error( $doc ) ) {
			self::log( sprintf( 'no invoice for order %d: %s', $order->get_id(), $doc->get_error_message() ) );
			return $doc;
		}

		/*
		 * ONE ORDER, ONE NUMBER, AND THE CHECK ABOVE IS NOT ENOUGH ON ITS OWN.
		 *
		 * `stored()` is a read, and two requests can both pass it before either
		 * writes: a webhook and a status change, two tabs of the admin, a retry.
		 * Both would then allocate, one number would be written and the other
		 * would be gone for ever, which is a hole in a sequence the law requires
		 * to be continuous and which cannot be repaired afterwards.
		 *
		 * A MySQL named lock, because it is exactly this primitive and it leaves
		 * nothing behind when the request ends, unlike a row or an option used
		 * as a mutex. Failing to take it means somebody else is issuing this
		 * order's invoice right now, and the right answer is to do nothing.
		 */
		$lock = 'teeshoop_invoice_' . $order->get_id();
		if ( ! self::lock( $lock ) ) {
			return new \WP_Error(
				'teeshoop_busy',
				__( 'La facture de cette commande est en cours d’émission ailleurs.', 'teeshoop' )
			);
		}

		try {
			// Re-read INSIDE the lock: the request that held it before us may
			// have been the one that issued, and `freeze_document` appends to
			// the list it finds on the object it is handed, so a stale one would
			// write back without whatever that request added.
			$order = wc_get_order( $order->get_id() ) ?: $order;
			$again = self::stored( $order );
			if ( null !== $again ) {
				return $again;
			}

			$series = self::series( $doc['date'] );
			$n      = self::next_number( $series );
			if ( $n <= 0 ) {
				return new \WP_Error( 'teeshoop_sequence', __( 'Le numéro de facture n’a pas pu être attribué.', 'teeshoop' ) );
			}

			$doc['series'] = $series;
			$doc['number'] = self::format_number( $series, $n );

			$lost = 0;
			self::pdf( $doc, $lost );
			if ( $lost > 0 ) {
				/*
				 * The number is already spent, and that is the lesser evil: a
				 * gap in the sequence cannot be repaired, and an issued number
				 * whose document is corrected later is ordinary. What must not
				 * happen is the document going out with a mangled name, so the
				 * order keeps the number and the operator is told.
				 */
				self::log( sprintf( 'order %d: %d character(s) cannot be written to a PDF', $order->get_id(), $lost ) );
			}

			self::freeze_document( $order, $doc );
			$order->update_meta_data( self::META_LOST, (string) $lost );
			$order->save();

			return $doc;
		} finally {
			self::unlock( $lock );
		}
	}

	/**
	 * Issue the facture d'acompte a receipt obliges.
	 *
	 * MANDATORY, AND THIS FILE ONCE SAID THE OPPOSITE. The first version of the
	 * README argued that an advance payment on a supply of GOODS triggers no
	 * document because VAT is not due until delivery. Both halves of that are
	 * wrong as the law stands, and it took reading the texts to find out:
	 *
	 *   CGI art. 289, I-1-c obliges an invoice "pour les acomptes qui lui sont
	 *   versés avant que l'une des opérations visées aux a et b ne soit
	 *   effectuée", and a) covers "les livraisons de biens OU les prestations de
	 *   services". The only carve-outs are exempt intra-EU supplies and new
	 *   means of transport. A domestic French sale of printed garments is
	 *   neither.
	 *
	 *   BOI-TVA-DECLA-30-20-10-10 § 120 removes the excuse in terms: "une
	 *   facture doit donc être délivrée pour TOUS les versements d'acomptes ...
	 *   et non pas pour les seules opérations pour lesquelles ces versements
	 *   entraînent l'exigibilité de la TVA".
	 *
	 *   And since 1 January 2023 the VAT is exigible anyway: CGI art. 269, 2-a,
	 *   "en cas de versement préalable d'un acompte, la taxe devient exigible au
	 *   moment de son encaissement, à concurrence du montant encaissé".
	 *
	 * SAME SEQUENCE, SAME SERIES. BOI-TVA-DECLA-30-20-20-10 § 60: the numbering
	 * obligation "concerne également les factures d'acomptes". A separate series
	 * would need a justification, and an acompte/solde split is not among the
	 * ones the administration lists.
	 *
	 * @param array $receipt One entry of the order's ledger.
	 * @return array|\WP_Error
	 */
	public static function issue_deposit( \WC_Order $order, array $receipt, ?string $environment = null ) {
		/*
		 * NOT AFTER THE FINAL INVOICE. An acompte is money received BEFORE the
		 * operation; once the definitive invoice exists there is nothing left to
		 * pay in advance of, and a document numbered after it would sit in the
		 * sequence claiming an advance on a sale already invoiced. `issue()` has
		 * always guarded on this and this did not.
		 */
		if ( null !== self::stored( $order ) ) {
			return new \WP_Error(
				'teeshoop_already_invoiced',
				__( 'Cette commande porte déjà sa facture définitive : aucun acompte ne peut plus être facturé dessus.', 'teeshoop' )
			);
		}

		$reference = (string) ( $receipt['reference'] ?? '' );
		foreach ( self::deposits( $order ) as $existing ) {
			if ( '' !== $reference && ( $existing['receipt'] ?? '' ) === $reference ) {
				// One receipt, one document. The ledger already refuses a
				// duplicate receipt; this refuses a duplicate document for a
				// receipt that reached here twice by another road.
				return $existing;
			}
		}

		$doc = self::compose_deposit( $order, $receipt, $environment );
		if ( is_wp_error( $doc ) ) {
			self::log( sprintf( 'no deposit invoice for order %d: %s', $order->get_id(), $doc->get_error_message() ) );
			return $doc;
		}

		$lock = 'teeshoop_invoice_' . $order->get_id();
		if ( ! self::lock( $lock ) ) {
			return new \WP_Error( 'teeshoop_busy', __( 'Un document est en cours d’émission pour cette commande.', 'teeshoop' ) );
		}

		try {
			/*
			 * RE-READ INSIDE THE LOCK, because `freeze_document` appends to the
			 * list it finds on the object it is handed. An order read before the
			 * lock is an order another request may have added a document to
			 * since, and appending to the stale copy would write it back without
			 * that document: a number already spent, and nothing carrying it.
			 */
			$order = wc_get_order( $order->get_id() ) ?: $order;
			if ( null !== self::stored( $order ) ) {
				return new \WP_Error( 'teeshoop_already_invoiced', __( 'Cette commande porte déjà sa facture définitive.', 'teeshoop' ) );
			}

			$series = self::series( $doc['date'] );
			$n      = self::next_number( $series );
			if ( $n <= 0 ) {
				return new \WP_Error( 'teeshoop_sequence', __( 'Le numéro de facture n’a pas pu être attribué.', 'teeshoop' ) );
			}
			$doc['series'] = $series;
			$doc['number'] = self::format_number( $series, $n );

			self::freeze_document( $order, $doc );
			$order->save();
			return $doc;
		} finally {
			self::unlock( $lock );
		}
	}

	/**
	 * The document model of a facture d'acompte.
	 *
	 * ONE LINE, AND THE VAT IS DERIVED FROM THE MONEY THAT ARRIVED. The customer
	 * transferred a TTC amount, so the HT is that amount divided by one plus the
	 * rate, rounded once, and the VAT is the remainder: the two always add back
	 * to what the bank shows, with no third rounding anywhere.
	 *
	 * @return array|\WP_Error
	 */
	public static function compose_deposit( \WC_Order $order, array $receipt, ?string $environment = null ) {
		$context = self::context( $order, $environment );
		if ( is_wp_error( $context ) ) {
			return $context;
		}

		$ttc = (int) ( $receipt['cents'] ?? 0 );
		if ( $ttc <= 0 ) {
			return new \WP_Error( 'teeshoop_no_amount', __( 'Cet encaissement ne porte aucun montant.', 'teeshoop' ) );
		}

		$rate = (float) $context['rate'];
		$ht   = Money::round( $ttc / ( 1 + $rate ) );
		$vat  = $ttc - $ht;

		return array_merge(
			$context['common'],
			array(
				'kind'        => self::KIND_DEPOSIT,
				/*
				 * FROZEN, like everything else on this page. Whether an operator
				 * had authorised a deposit decides which commitment the document
				 * carries, so reading it live would let a later authorisation
				 * rewrite what a document already sent to a customer says.
				 */
				'authorised'  => Ledger::authorised( $order ),
				'receipt'     => (string) ( $receipt['reference'] ?? '' ),
				// 10° of article 242 nonies A: the date the acompte was paid,
				// when it differs from the date the document is issued.
				'paid_on'     => (string) ( $receipt['date'] ?? '' ),
				'method'      => (string) ( $receipt['method'] ?? '' ),
				'lines'       => array(
					array(
						'label'    => sprintf(
							/* translators: %s: an order number. */
							__( 'Acompte sur la commande %s', 'teeshoop' ),
							(string) $order->get_order_number()
						),
						'detail'   => '',
						'qty'      => 1,
						'unit_ht'  => $ht,
						'total_ht' => $ht,
						'rate'     => $rate,
					),
				),
				'shipping_ht' => 0,
				'discount_ht' => 0,
				'fees_ht'     => 0,
				'total_ht'    => $ht,
				'total_vat'   => $vat,
				'total_ttc'   => $ttc,
				'deducted'    => array(),
				'net_to_pay'  => 0,
			)
		);
	}

	/**
	 * A MySQL named lock, or false.
	 *
	 * Two seconds, because the work inside it is one INSERT and one order save:
	 * anything slower than that is a database in trouble, and waiting longer
	 * would only turn a race into a queue of stalled checkouts.
	 *
	 * PUBLIC, AND THIS IS THE SHOP'S ONE NAMED LOCK. `Bat` needs the same thing
	 * for the same reason: a read-modify-write on a JSON list in order meta,
	 * where losing the loser of the race loses a customer's approval or a
	 * version the workshop is about to press. Copying two lines of SQL into a
	 * second file would be a second idiom to get the timeout and the release
	 * right in. It lives here because this is where it was first needed, not
	 * because it is about invoices.
	 */
	public static function lock( string $name ): bool {
		global $wpdb;
		return '1' === (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $name, 2 ) );
	}

	public static function unlock( string $name ): void {
		global $wpdb;
		$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $name ) );
	}

	/**
	 * Every frozen document on this order, oldest first.
	 *
	 * Falls back to the single-document meta for orders invoiced before this
	 * plugin knew about deposits. Those are real orders with real numbers and
	 * dropping them would be losing a fiscal record to a refactor.
	 */
	public static function documents( \WC_Order $order ): array {
		$raw = (string) $order->get_meta( self::META_DOCS, true );
		if ( '' !== $raw ) {
			$docs = json_decode( $raw, true );
			return is_array( $docs ) ? array_values( array_filter( $docs, 'is_array' ) ) : array();
		}

		$single = (string) $order->get_meta( self::META_DOC, true );
		if ( '' === $single ) {
			return array();
		}
		$doc = json_decode( $single, true );
		return is_array( $doc ) && ! empty( $doc['number'] ) ? array( $doc ) : array();
	}

	/** The FINAL invoice, or null when the order has not been settled yet. */
	public static function stored( \WC_Order $order ): ?array {
		foreach ( self::documents( $order ) as $doc ) {
			if ( self::KIND_DEPOSIT !== ( $doc['kind'] ?? self::KIND_INVOICE ) ) {
				return $doc;
			}
		}
		return null;
	}

	/** The deposit invoices already issued, oldest first. */
	public static function deposits( \WC_Order $order ): array {
		return array_values(
			array_filter(
				self::documents( $order ),
				static fn( array $doc ): bool => self::KIND_DEPOSIT === ( $doc['kind'] ?? '' )
			)
		);
	}

	/** Append a frozen document to the order, under the sequence lock. */
	private static function freeze_document( \WC_Order $order, array $doc ): void {
		$docs   = self::documents( $order );
		$docs[] = $doc;
		$order->update_meta_data( self::META_DOCS, wp_json_encode( $docs ) );
		if ( self::KIND_DEPOSIT !== ( $doc['kind'] ?? self::KIND_INVOICE ) ) {
			// The final invoice keeps the two flat fields the admin and the
			// customer link read.
			$order->update_meta_data( self::META_NUMBER, $doc['number'] );
			$order->update_meta_data( self::META_DATE, $doc['date'] );
			$order->update_meta_data( self::META_DOC, wp_json_encode( $doc ) );
		}
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
	/**
	 * Everything both kinds of document share, or the reason there is none.
	 *
	 * Extracted so the two gates that refuse a document, an unknown regime and
	 * an incomplete seller, are asked once. A facture d'acompte that skipped
	 * either of them would be exactly as non-conforming as a final invoice that
	 * did, and it would already be numbered.
	 *
	 * @return array|\WP_Error
	 */
	private static function context( \WC_Order $order, ?string $environment = null ) {
		/*
		 * THE DATE OF ISSUE, not the date of the order, and that is both the law
		 * and the sequence. Article 242 nonies A, I, 6° wants "la date de
		 * délivrance ou d'émission"; the order's own date is printed separately
		 * two lines below it. And the series is keyed on this date: dating a
		 * document by its ORDER meant an order taken on 28 December and paid on
		 * 3 January was numbered into the previous year's series AFTER that
		 * year had closed, which is precisely the "séquence chronologique et
		 * continue" the whole file is built around.
		 */
		$date        = Settings::today();
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

		/*
		 * AN ERASED ORDER CAN NEVER BE INVOICED, AND THIS IS THE ONLY PLACE THAT
		 * CAN STOP IT.
		 *
		 * The sequence between an erasure and a payment is ordinary and it was
		 * measured: an order sits `on-hold` waiting for a transfer, so it is
		 * unpaid and carries no invoice, and there is therefore nothing fiscal to
		 * weigh against an erasure request. `Privacy::erase_order` empties the
		 * buyer, correctly. The transfer then arrives, an operator moves the order
		 * to `processing`, `on_status` fires, `is_paid()` is now true, and
		 * `buyer()` reads the fields that were emptied. Measured on the mirror:
		 * ESSAI2026-16260 issued with an empty company, an empty name and an empty
		 * address, on a document an accountant keeps for ten years, having
		 * consumed a number out of a sequence that is gapless by construction and
		 * cannot give it back.
		 *
		 * Every other guard in this function looks at the SELLER or at the
		 * regime. None of them looks at whether the buyer still exists.
		 */
		if ( '' !== (string) $order->get_meta( Privacy::META_ERASED, true ) ) {
			return new \WP_Error(
				'teeshoop_order_erased',
				__( 'Les données de cette commande ont été effacées à la demande du client : aucune facture ne peut plus en être tirée, parce qu’elle ne porterait aucun acheteur. Si une facture était due, elle devait être émise avant l’effacement.', 'teeshoop' )
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

		$config = self::config();

		return array(
			'rate'   => $rate,
			'common' => array(
				'number'      => '',
				'series'      => '',
				'kind'        => self::KIND_INVOICE,
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
				// Read ONCE, here, and frozen with the rest of the document. See
				// the note in `mentions()`.
				'renonciation' => Waiver::invoice_line( $order ),
				'receipts'    => Ledger::receipts( $order ),
				'terms'       => array(
					'penalty_rate' => (string) $config['penalty_rate'],
					'indemnity'    => self::RECOVERY_INDEMNITY_EUR,
				),
				'stamp'       => Legal::STAMP === $verdict['action'] ? Legal::STAMP_TEXT : '',
				'missing'     => $verdict['labels'],
			),
		);
	}

	/**
	 * What an order comes to, in cents, in one place.
	 *
	 * PUBLIC AND SHARED because two things now need it and they must never
	 * disagree: this document, and the margin report (Costing.php), whose whole
	 * job is to say what the order earned. A second derivation of "the order's
	 * HT" would eventually differ by a coupon or a fee, and the shop would then
	 * have an invoice that says one number and a profitability screen that says
	 * another, with nothing to say which is right.
	 *
	 * `get_subtotal()` on a line, which is BEFORE any discount, because the
	 * discount gets a line of its own on the document (article 242 nonies A, I,
	 * 9° makes it mandatory) and summing the net total AND subtracting the
	 * discount counted the reduction twice.
	 *
	 * @return array{goods_ht:int,shipping_ht:int,fees_ht:int,discount_ht:int,total_ht:int,total_tax:int,total_ttc:int}
	 */
	public static function order_totals( \WC_Order $order ): array {
		$goods_ht = 0;
		foreach ( $order->get_items() as $item ) {
			if ( $item instanceof \WC_Order_Item_Product ) {
				$goods_ht += Money::from_eur( (string) $item->get_subtotal() );
			}
		}

		$shipping_ht = Money::from_eur( (string) $order->get_shipping_total() );
		$discount_ht = Money::from_eur( (string) $order->get_discount_total() );

		$fees_ht = 0;
		foreach ( $order->get_fees() as $fee ) {
			$fees_ht += Money::from_eur( (string) $fee->get_total() );
		}

		return array(
			'goods_ht'    => $goods_ht,
			'shipping_ht' => $shipping_ht,
			'fees_ht'     => $fees_ht,
			'discount_ht' => $discount_ht,
			'total_ht'    => $goods_ht + $shipping_ht + $fees_ht - $discount_ht,
			'total_tax'   => Money::from_eur( (string) $order->get_total_tax() ),
			'total_ttc'   => Money::from_eur( (string) $order->get_total() ),
		);
	}

	public static function compose( \WC_Order $order, ?string $environment = null ) {
		$context = self::context( $order, $environment );
		if ( is_wp_error( $context ) ) {
			return $context;
		}
		$rate   = (float) $context['rate'];
		$regime = (string) $context['common']['regime'];

		$lines = array();

		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$qty = max( 1, (int) $item->get_quantity() );
			/*
			 * THE SUBTOTAL, WHICH IS BEFORE ANY DISCOUNT, because the discount
			 * gets a line of its own further down (article 242 nonies A, I, 9°
			 * makes it mandatory). `get_total()` is already net, so summing that
			 * AND subtracting `get_discount_total()` counted the reduction
			 * twice: the totals assertion then failed and the order could not be
			 * invoiced at all. With no coupons the two are equal and nothing
			 * changes; the day one exists, the document is right.
			 */
			$total_ht = Money::from_eur( (string) $item->get_subtotal() );

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

		$totals      = self::order_totals( $order );
		$shipping_ht = $totals['shipping_ht'];
		$discount_ht = $totals['discount_ht'];
		$fees_ht     = $totals['fees_ht'];
		$total_tax   = $totals['total_tax'];
		$total_ttc   = $totals['total_ttc'];
		$total_ht    = $totals['total_ht'];

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
		 * AND THE RATE MUST DESCRIBE THE AMOUNT. The sum above proves the order
		 * adds up; it says nothing about whether the VAT line is the rate the
		 * document prints. WooCommerce's tax table emptied by a bad edit gives a
		 * total_tax of zero on an order the regime says is taxable, and the
		 * invoice would print "TVA 20 %" next to 0,00 EUR: an announcement of a
		 * tax that was never charged, which the customer would try to reclaim.
		 *
		 * The tolerance is there because WooCommerce rounds tax PER LINE and
		 * this rounds once over the whole base, so a few cents of spread on a
		 * many-line order is normal arithmetic and not a fault.
		 */
		$expected_vat = Money::pct( $total_ht, $rate );
		$tolerance    = max( 2, count( $lines ) + 1 );
		if ( abs( $total_tax - $expected_vat ) > $tolerance ) {
			return new \WP_Error(
				'teeshoop_vat_mismatch',
				sprintf(
					/* translators: %d: an order number. */
					__( 'La TVA enregistrée sur la commande %d ne correspond pas au taux sous lequel elle a été prise. Aucune facture n’est émise tant que ce n’est pas expliqué.', 'teeshoop' ),
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

		/*
		 * THE ACOMPTE INVOICES ALREADY ISSUED, DEDUCTED BY NUMBER AND BY DATE.
		 * BOI-TVA-DECLA-30-20-20-10 § 60: "la facture définitive doit faire
		 * référence aux différentes factures d'acomptes". And the VAT on those
		 * became exigible when they were collected, so it must not be declared
		 * again: the document states the whole operation, deducts each acompte
		 * at its TTC, and shows what is left to pay.
		 *
		 * The layout is the standard one and it is NOT prescribed by any text we
		 * could find. Question 16 asks the accountant to confirm it before it is
		 * treated as settled.
		 */
		$deducted = array();
		$paid_off = 0;
		foreach ( self::deposits( $order ) as $deposit ) {
			$deducted[] = array(
				'number' => (string) $deposit['number'],
				'date'   => (string) $deposit['date'],
				'ttc'    => (int) $deposit['total_ttc'],
			);
			$paid_off += (int) $deposit['total_ttc'];
		}

		/*
		 * AND EVERY EARLIER RECEIPT MUST BE ACCOUNTED FOR.
		 *
		 * `deducted` is built from the acompte DOCUMENTS, so a document that was
		 * refused when its money arrived (a busy lock, a sequence that would not
		 * allocate) simply vanishes from this list, and the invoice then asks the
		 * customer for the whole total having already banked part of it. Nothing
		 * would have said so: the money is in the ledger and the deduction is
		 * not.
		 *
		 * The invariant is exact. Every receipt except the one that settled the
		 * order should carry a document, so what those documents cover must be
		 * everything received except the last payment. Anything else is a
		 * document that is missing, and the answer to a missing document is not
		 * to bill around it.
		 */
		$receipts = (array) $context['common']['receipts'];
		if ( ! empty( $receipts ) ) {
			$last     = (int) $receipts[ count( $receipts ) - 1 ]['cents'];
			$received = 0;
			foreach ( $receipts as $receipt ) {
				$received += (int) $receipt['cents'];
			}
			if ( $received - $last !== $paid_off ) {
				return new \WP_Error(
					'teeshoop_deposits_missing',
					sprintf(
						/* translators: %d: an order number. */
						__( 'La commande %d a encaissé des acomptes qui ne portent pas tous leur facture, donc la facture définitive ne peut pas les déduire. Émettez les factures d’acompte manquantes avant de facturer.', 'teeshoop' ),
						$order->get_id()
					)
				);
			}
		}

		return array_merge(
			$context['common'],
			array(
				'kind'        => self::KIND_INVOICE,
				'lines'       => $lines,
				'shipping_ht' => $shipping_ht,
				'discount_ht' => $discount_ht,
				'fees_ht'     => $fees_ht,
				'total_ht'    => $total_ht,
				'total_vat'   => $total_tax,
				'total_ttc'   => $total_ttc,
				'deducted'    => $deducted,
				'net_to_pay'  => max( 0, $total_ttc - $paid_off ),
			)
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
	public static function pdf( array $doc, ?int &$lost = null ): string {
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

		$deposit = self::KIND_DEPOSIT === ( $doc['kind'] ?? self::KIND_INVOICE );
		$y       = self::pdf_header( $pdf, $doc, $left, $right, $deposit );

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
				$pdf->text_right( $col_rate, $y, self::rate_label( (float) $line['rate'] ) );
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
				$pdf->text_right( $col_rate, $y, self::rate_label( (float) $doc['rate'] ) );
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
					self::rate_label( (float) $doc['rate'] )
				)
			);
			$pdf->text_right( $col_total, $y, Money::format( (int) $doc['total_vat'] ) );
			$y += 6.5;
			$pdf->text_right( $totals_label, $y, __( 'Total TTC', 'teeshoop' ), Pdf::BOLD, 10.5 );
			$pdf->text_right( $col_total, $y, Money::format( (int) $doc['total_ttc'] ), Pdf::BOLD, 10.5 );
			$y += 9;
		}

		// ── what the acomptes already covered ────────────────────────────────
		if ( ! empty( $doc['deducted'] ) ) {
			$pdf->rule( $totals_label - 40, $y - 4, $right, 0.15, 0.82 );
			foreach ( (array) $doc['deducted'] as $deduction ) {
				$pdf->text_right(
					$totals_label,
					$y,
					sprintf(
						/* translators: 1: an invoice number, 2: a date. */
						__( 'Acompte %1$s du %2$s', 'teeshoop' ),
						(string) $deduction['number'],
						Vat::fr_date( (string) $deduction['date'] )
					)
				);
				$pdf->text_right( $col_total, $y, Money::format( -(int) $deduction['ttc'] ) );
				$y += 5.5;
			}
			$y += 1;
			$pdf->text_right( $totals_label, $y, __( 'Net à payer', 'teeshoop' ), Pdf::BOLD, 10.5 );
			$pdf->text_right( $col_total, $y, Money::format( (int) $doc['net_to_pay'] ), Pdf::BOLD, 10.5 );
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

		/*
		 * AND A PAGE BREAK BEFORE THEM, because the clamp below cannot save a
		 * tall document. `max( $y + 6, ... )` lets the block start wherever the
		 * totals ended, so on an order with a dozen lines it started at 256 mm
		 * and drew its last mention at 299 mm on a 297 mm page: the tail of the
		 * recovery-indemnity clause was simply gone. Measured by reading the Td
		 * coordinates back out of the content stream. The line loop has had this
		 * discipline since the first version; the block below it had none, and
		 * the comment above claimed otherwise.
		 */
		$foot   = 288.0 - count( $wrapped ) * 3.6;
		$y      = max( $y + 6, min( 246.0, $foot ) );
		$bottom = $y + ( count( $wrapped ) - 1 ) * 3.6;
		if ( $bottom > 288.0 ) {
			$pdf->page_break();
			$y = 24.0;
		}
		$pdf->rule( $left, $y - 4, $right, 0.15, 0.82 );

		foreach ( $wrapped as $line ) {
			$pdf->text( $left, $y, $line, Pdf::REGULAR, 7.2, 0.25 );
			$y += 3.6;
		}

		if ( '' !== (string) $doc['stamp'] ) {
			$pdf->stamp( (string) $doc['stamp'] );
		}

		$out = $pdf->render(
			sprintf(
				/* translators: %s: an invoice number. */
				__( 'Facture %s', 'teeshoop' ),
				(string) $doc['number']
			),
			self::pdf_date( (string) $doc['date'] )
		);

		/*
		 * REPORTED, so a caller can refuse. `Pdf` has counted the characters it
		 * could not write since it was written, its docblock says "Must be 0 to
		 * issue", and nothing asked: a buyer whose company name leaves
		 * Windows-1252 was invoiced under a name full of question marks, which
		 * is not their name and is not a document that identifies its customer.
		 */
		$lost = $pdf->lost();
		return $out;
	}

	/** The two identity blocks and the title. Returns the y to carry on from. */
	private static function pdf_header( Pdf $pdf, array $doc, float $left, float $right, bool $deposit = false ): float {
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
		// A facture d'acompte says so in the largest type on the page: it is a
		// different document and a customer must not file it as the invoice.
		$pdf->text_right(
			$right,
			24,
			$deposit ? __( 'FACTURE D’ACOMPTE', 'teeshoop' ) : __( 'FACTURE', 'teeshoop' ),
			Pdf::BOLD,
			$deposit ? 15 : 20
		);
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

		/*
		 * 10° of article 242 nonies A, the date the acompte was paid, is printed
		 * once, in mentions(). It used to be printed here as well, guarded on
		 * the paid date differing from the issue date: `Ledger::record` stamps
		 * the receipt with `Settings::today()` and `context()` dates the
		 * document with the same call in the same request, and the operator's
		 * box has no date field, so that guard is false except across midnight,
		 * and on the one night it is true both lines print the same sentence.
		 * Dead on every other day and duplicated on that one.
		 */

		$ship = (array) $doc['shipping_to'];
		if ( ! empty( $ship ) ) {
			/*
			 * WRAPPED, not truncated, and it is the one customer-typed string on
			 * the page that had neither. Two free-text checkout fields plus a
			 * town run past the right margin at about 123 characters and off the
			 * sheet at about 135, and article 242 nonies A, I, 7° bis makes this
			 * block mandatory exactly when it differs from the billing address,
			 * so cutting the town off is losing required content rather than
			 * losing a label.
			 */
			$lines_ship = Pdf::wrap(
				__( 'Livraison', 'teeshoop' ) . ' : ' . trim( $ship['address'] . ', ' . $ship['postcode'] . ' ' . $ship['city'] ),
				$right - $left,
				Pdf::REGULAR,
				8.5
			);
			foreach ( $lines_ship as $line_ship ) {
				$pdf->text( $left, $y, $line_ship, Pdf::REGULAR, 8.5, 0.3 );
				$y += 4;
			}
			$y += 1;
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

		/*
		 * THE WITHDRAWAL RIGHT, ON THE DOCUMENT THE CUSTOMER KEEPS.
		 *
		 * Frozen into the document at issue rather than read from the order when
		 * the PDF is rendered, like everything else here: an invoice re-rendered
		 * a year later must say what was true when it was issued, and the whole
		 * reason a frozen snapshot exists is that the order will have moved.
		 * `Waiver::invoice_line` reads the order once, in `compose()`.
		 */
		if ( '' !== (string) ( $doc['renonciation'] ?? '' ) ) {
			$out[] = (string) $doc['renonciation'];
		}

		/*
		 * WHAT THE MONEY IS, on the document that asks for it. An advance
		 * payment that is not qualified is presumed to be des arrhes for a
		 * consumer (L. 214-1), and that presumption is disapplied here by
		 * L. 214-3 for goods made to order, so nothing decides it except what
		 * the document says. An acompte binds both sides; arrhes let either walk
		 * away. The difference is the whole order.
		 */
		if ( self::KIND_DEPOSIT === ( $doc['kind'] ?? self::KIND_INVOICE ) ) {
			// A document frozen before this field existed predates any deposit
			// anyone approved, so it takes the branch that claims less.
			$out[] = null === ( $doc['authorised'] ?? null )
				? Settlement::ON_ACCOUNT_FR
				: Settlement::COMMITMENT_FR;
		}

		$order    = (array) $doc['order'];
		$receipts = (array) ( $doc['receipts'] ?? array() );

		if ( self::KIND_DEPOSIT === ( $doc['kind'] ?? self::KIND_INVOICE ) ) {
			/*
			 * A RECEIPT, NOT A DEMAND. This document is issued because money has
			 * ALREADY arrived, and the generic branch below printed "règlement à
			 * la commande, à réception de la présente facture" on it: a customer
			 * reading that would think they owed the acompte a second time, with
			 * the late-payment clause underneath it saying what happens if they
			 * do not pay.
			 */
			$out[] = sprintf(
				/* translators: 1: a date, 2: a payment method. */
				__( 'Acompte encaissé le %1$s par %2$s. Cette facture ne réclame aucun règlement.', 'teeshoop' ),
				Vat::fr_date( (string) ( $doc['paid_on'] ?? $doc['date'] ) ),
				'' !== (string) ( $doc['method'] ?? '' ) ? (string) $doc['method'] : __( 'virement', 'teeshoop' )
			);
		} elseif ( count( $receipts ) > 1 ) {
			// Two or more transfers: name each, because that is what a bank
			// statement will show and what an accountant will reconcile against.
			$parts = array();
			foreach ( $receipts as $receipt ) {
				$parts[] = sprintf(
					/* translators: 1: an amount, 2: a date. */
					__( '%1$s le %2$s', 'teeshoop' ),
					Money::format( (int) $receipt['cents'] ),
					Vat::fr_date( (string) $receipt['date'] )
				);
			}
			$out[] = sprintf(
				/* translators: %s: a list of payments, already assembled. */
				__( 'Règlement à la commande. Reçu : %s.', 'teeshoop' ),
				implode( ', ', $parts )
			);
		} elseif ( '' !== (string) $order['paid'] ) {
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

	/**
	 * A VAT rate as a French document writes it: "20 %", "8,5 %", "5,5 %".
	 *
	 * NOT rounded to a whole percent, which is what the first version did.
	 * `Money::number( $rate * 100, 0 )` printed an 8,5 % sale as "TVA 9 %" next
	 * to a VAT amount computed at 8,5, so the invoice contradicted its own
	 * arithmetic and the number a customer would reclaim was the wrong one. This
	 * shop is at 20 % today, where the bug is invisible, and the DOM are at
	 * 8,5 %, which is exactly where a fiscal question is already open.
	 */
	private static function rate_label( float $rate ): string {
		$written = Money::number( $rate * 100, 2 );
		// Trailing zeros only: "20,00" becomes "20" and "8,50" becomes "8,5".
		$written = rtrim( rtrim( $written, '0' ), ',' );
		return $written . "\u{00A0}%";
	}

	/** "D:20260818120000+00'00'", which is how a PDF writes a date. */
	private static function pdf_date( string $iso ): string {
		$iso = Vat::iso_date( $iso );
		return 'D:' . ( '' === $iso ? '19700101' : str_replace( '-', '', $iso ) ) . "000000+00'00'";
	}

	// ── Handing it over ──────────────────────────────────────────────────────

	/**
	 * The URL that downloads one of an order's documents.
	 *
	 * `$number` names which, because an order settled in two payments has two
	 * and a customer needs both: the acompte for their own accounts when they
	 * pay it, and the final invoice when the job is done. Empty means the final
	 * invoice, which is what every existing link asks for.
	 */
	public static function url( \WC_Order $order, string $number = '' ): string {
		$args = array(
			'action'   => 'teeshoop_facture',
			'order_id' => $order->get_id(),
			'key'      => $order->get_order_key(),
		);
		if ( '' !== $number ) {
			$args['numero'] = $number;
		}
		return add_query_arg( $args, admin_url( 'admin-post.php' ) );
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

		/*
		 * READ ONLY. This used to issue on demand when there was no document
		 * yet, which meant a GET consumed a number out of a legally continuous
		 * fiscal sequence: anyone holding the order key, which the customer has
		 * in their order-received URL and in every e-mail, could number an
		 * invoice for an order that was abandoned at the payment step and will
		 * never be paid. A number cannot be reclaimed, only cancelled by an
		 * avoir, so the damage is permanent and it is one request wide.
		 *
		 * Invoices are issued when the money arrives, by `on_payment` and
		 * `on_status`, and by nothing else.
		 */
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- the order key is the capability, checked above.
		$wanted = isset( $_GET['numero'] ) ? sanitize_text_field( wp_unslash( $_GET['numero'] ) ) : '';

		$doc = null;
		if ( '' !== $wanted ) {
			foreach ( self::documents( $order ) as $candidate ) {
				if ( ( $candidate['number'] ?? '' ) === $wanted ) {
					$doc = $candidate;
					break;
				}
			}
		} else {
			$doc = self::stored( $order );
		}

		if ( null === $doc ) {
			wp_die(
				esc_html__( 'Ce document n’est pas encore émis : la facture l’est au règlement, l’acompte à son encaissement.', 'teeshoop' ),
				'',
				array( 'response' => 409 )
			);
		}

		$pdf = self::pdf( $doc );

		nocache_headers();
		header( 'Content-Type: application/pdf' );
		header( 'Content-Length: ' . strlen( $pdf ) );
		header( 'Content-Disposition: attachment; filename="' . sanitize_file_name( $doc['number'] ) . '.pdf"' );
		echo $pdf; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- binary PDF.
		exit;
	}

	/** The links a customer sees under their order, one per document. */
	public static function customer_link( \WC_Order $order ): void {
		foreach ( self::documents( $order ) as $doc ) {
			printf(
				'<p class="teeshoop-facture"><a href="%s">%s</a></p>',
				esc_url( self::url( $order, (string) $doc['number'] ) ),
				esc_html(
					sprintf(
						self::KIND_DEPOSIT === ( $doc['kind'] ?? self::KIND_INVOICE )
							/* translators: %s: a document number. */
							? __( 'Télécharger la facture d’acompte %s (PDF)', 'teeshoop' )
							/* translators: %s: a document number. */
							: __( 'Télécharger la facture %s (PDF)', 'teeshoop' ),
						(string) $doc['number']
					)
				)
			);
		}
	}

	/** And the one an operator sees, with the reason when there is none. */
	public static function admin_link( \WC_Order $order ): void {
		$doc = self::stored( $order );
		if ( null !== $doc ) {
			$lost = (int) $order->get_meta( self::META_LOST, true );
			if ( $lost > 0 ) {
				printf(
					'<p class="form-field form-field-wide"><strong>%s</strong> %s</p>',
					esc_html__( 'Facture', 'teeshoop' ),
					esc_html(
						sprintf(
							/* translators: %d: a number of characters. */
							_n(
								'%d caractère du document ne peut pas être écrit dans un PDF et sort en point d’interrogation. Corrigez le nom ou l’adresse dans la commande, puis rééditez.',
								'%d caractères du document ne peuvent pas être écrits dans un PDF et sortent en points d’interrogation. Corrigez le nom ou l’adresse dans la commande, puis rééditez.',
								$lost,
								'teeshoop'
							),
							$lost
						)
					)
				);
			}
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
