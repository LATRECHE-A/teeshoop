<?php
/**
 * Where an order is, who is waiting on whom, and what may happen next.
 *
 * WHY A DEDICATED MODULE AND NOT TWENTY-FIVE WOOCOMMERCE STATUSES. The Bible
 * asks for it in as many words (chapitre 2, « les statuts métiers Teeshoop
 * doivent être gérés par un module dédié afin de ne pas forcer toute la logique
 * dans les statuts standards ») and chapitre 2's own list runs to twenty-five
 * entries, most of which are CRM states (« devis consulté », « relance
 * planifiée ») on a document that is not an order yet. What is modelled here is
 * the life of a PAID order, from the money landing to the parcel arriving, and
 * nothing else.
 *
 * WHERE WOOCOMMERCE HAS A WORD, WOOCOMMERCE'S WORD IS USED. `processing` is
 * paid-and-not-yet-fulfilled, `completed` is delivered, `cancelled` and
 * `refunded` are themselves. Inventing a second slug for any of those would
 * fork every WooCommerce query, every report and every one of its own screens.
 * Seven statuses are added, and each exists because WooCommerce has no word for
 * it: waiting on artwork, proof sent, changes requested, proof approved, in
 * production, printed, dispatched.
 *
 * THE STATUS IS A LABEL. THE RECORD IS THE AUTHORITY. This is the same rule
 * `Ledger` already holds for money, and it is here for the same reason: a shop
 * manager can pick any status from a dropdown, so a gate that reads the label is
 * a gate a click opens. `blockers()` asks the ledger how much money is actually
 * in and asks `Bat` whether the CURRENT version of the proof is actually
 * approved. Session 07's press must call `blockers()`, never `get_status()`.
 *
 * THE MACHINE IS PURE and lives in the first half of this file: `allowed()`,
 * `refusal()`, `next()` and `needs()` call no WordPress function and are tested
 * by `php tests/run.php`. The second half applies a transition to a real order.
 *
 * REFUSING A TRANSITION IS NOT OPTIONAL AND IT CANNOT BE DONE BY THROWING.
 * `WC_Order::save()` catches every exception its own pre-save hook raises, logs
 * it, and then runs `status_transition()` anyway, so a throw produces an order
 * that was not saved while every listener is told it moved. The refusal
 * therefore puts the stored status back, which makes the transition a no-op,
 * and says so on the order and to the operator. See `guard()`.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Lifecycle {

	// ── the statuses this module adds ────────────────────────────────────────

	/** Paid, and the artwork cannot be used as it is. */
	public const WAIT = 'ts-attente';

	/** The proof has been sent and the customer has not answered. */
	public const PROOF = 'ts-bat';

	/** The customer asked for changes. We are the ones who owe something. */
	public const CHANGES = 'ts-bat-mod';

	/** The proof is approved. Production is authorised, nothing else is. */
	public const APPROVED = 'ts-bat-ok';

	/** On the press. */
	public const PRODUCTION = 'ts-prod';

	/** Pressed, checked, ready to pack. */
	public const PRINTED = 'ts-imprime';

	/** Handed to the carrier, or collected. */
	public const SHIPPED = 'ts-expedie';

	/** WooCommerce's own, named here so the machine reads as one list. */
	public const PENDING   = 'pending';
	public const HOLD      = 'on-hold';
	public const FAILED    = 'failed';
	public const DEPOSIT   = 'ts-acompte';
	public const PAID      = 'processing';
	public const DELIVERED = 'completed';
	public const CANCELLED = 'cancelled';
	public const REFUNDED  = 'refunded';

	/** Order meta: the journal, one entry per transition, JSON. */
	public const META_JOURNAL = '_teeshoop_journal';

	/**
	 * Order meta: the stage the order had reached when it was cancelled.
	 *
	 * A SECOND CANCELLED STATUS WAS THE OBVIOUS SHAPE AND IT IS THE WRONG ONE.
	 * « Annulé après BAT » is a real and painful case (chapitre 2: « après
	 * validation du BAT et lancement : pas d'annulation automatique ; traitement
	 * au cas par cas ») because film is bought and garments are ordered by then.
	 * But a second slug forks the question "is this order cancelled" across two
	 * answers, and every WooCommerce screen, report and query knows only one of
	 * them. So there is one `cancelled`, and the order remembers what it was
	 * cancelled OUT of, which is the fact the workshop and the SAV actually need.
	 */
	public const META_CANCEL_STAGE = '_teeshoop_annule_depuis';

	/** How many journal entries an order keeps. A loop must not fill a table. */
	private const JOURNAL_MAX = 200;

	// ── the machine, pure ────────────────────────────────────────────────────

	/**
	 * Every status this shop's orders use, in the order they are lived, with
	 * the French an operator reads.
	 *
	 * @return array<string,string>
	 */
	public static function statuses(): array {
		return array(
			self::PENDING    => 'En attente de paiement',
			self::HOLD       => 'En attente',
			self::FAILED     => 'Paiement échoué',
			self::DEPOSIT    => 'Acompte reçu',
			self::PAID       => 'Payée',
			self::WAIT       => 'En attente de fichier',
			self::PROOF      => 'BAT envoyé',
			self::CHANGES    => 'Modifications demandées',
			self::APPROVED   => 'BAT validé',
			self::PRODUCTION => 'En production',
			self::PRINTED    => 'Imprimée',
			self::SHIPPED    => 'Expédiée',
			self::DELIVERED  => 'Livrée',
			self::CANCELLED  => 'Annulée',
			self::REFUNDED   => 'Remboursée',
		);
	}

	/** The seven this module registers with WooCommerce. */
	public static function ours(): array {
		return array( self::WAIT, self::PROOF, self::CHANGES, self::APPROVED, self::PRODUCTION, self::PRINTED, self::SHIPPED );
	}

	/**
	 * The whole state machine, as `from => [to, …]`.
	 *
	 * READ THE ABSENCES. There is no edge from anything into `ts-prod` except
	 * from `ts-bat-ok` and from `completed`, and that is the rule the whole
	 * chapter exists to enforce: « aucune production sans BAT ». The second one
	 * is a reprint under SAV, which is a real thing that happens to a delivered
	 * order and must not require faking a status to get to.
	 *
	 * `ts-bat-ok -> ts-bat` is not a mistake either: issuing a new version of
	 * the proof sends the order back to waiting for an answer, because an
	 * approval of version 3 authorises nothing about version 4. The status
	 * follows; `Bat::approved()` is what actually decides.
	 *
	 * WooCommerce's own transitions are all here, because this machine sees
	 * every save. Refusing one of them would break the shop rather than protect
	 * it: a gateway moving `pending -> processing`, a refund, a cancellation.
	 *
	 * @return array<string,string[]>
	 */
	public static function graph(): array {
		$dead = array( self::CANCELLED, self::REFUNDED );

		return array(
			self::PENDING    => array_merge( array( self::PAID, self::DEPOSIT, self::HOLD, self::FAILED ), $dead ),
			self::HOLD       => array_merge( array( self::PAID, self::DEPOSIT, self::FAILED, self::PENDING ), $dead ),
			self::FAILED     => array_merge( array( self::PAID, self::DEPOSIT, self::PENDING, self::HOLD ), $dead ),
			self::DEPOSIT    => array_merge( array( self::PAID, self::WAIT, self::PROOF ), $dead ),
			self::PAID       => array_merge( array( self::WAIT, self::PROOF ), $dead ),
			self::WAIT       => array_merge( array( self::PROOF ), $dead ),
			self::PROOF      => array_merge( array( self::APPROVED, self::CHANGES, self::WAIT ), $dead ),
			self::CHANGES    => array_merge( array( self::PROOF, self::WAIT ), $dead ),
			self::APPROVED   => array_merge( array( self::PRODUCTION, self::PROOF ), $dead ),
			self::PRODUCTION => array_merge( array( self::PRINTED, self::CHANGES ), $dead ),
			self::PRINTED    => array_merge( array( self::SHIPPED, self::PRODUCTION ), $dead ),
			self::SHIPPED    => array_merge( array( self::DELIVERED, self::PRINTED ), array( self::REFUNDED ) ),
			self::DELIVERED  => array( self::PRODUCTION, self::REFUNDED ),
			// An order cancelled by mistake, or a customer who changed their
			// mind before anything was bought, goes back to where it was paid.
			self::CANCELLED  => array( self::PAID, self::DEPOSIT, self::PENDING ),
			// A refund is the end. Undoing one is a second sale, not a status.
			self::REFUNDED   => array(),
		);
	}

	/** Whether the machine has this edge at all. Says nothing about conditions. */
	public static function allowed( string $from, string $to ): bool {
		if ( $from === $to ) {
			return true;
		}
		$graph = self::graph();
		if ( ! isset( $graph[ $from ] ) ) {
			/*
			 * A STATUS THIS MACHINE HAS NEVER HEARD OF IS NOT A FREE PASS. Any
			 * plugin may register one, and the safe answer for a status nobody
			 * modelled is that it may move to WooCommerce's own terminals and
			 * nowhere into our production chain.
			 */
			return in_array( $to, array( self::CANCELLED, self::REFUNDED, self::PENDING, self::PAID, self::HOLD, self::FAILED ), true );
		}
		return in_array( $to, $graph[ $from ], true );
	}

	/** Where an order in `$from` may legally go, in the order they are offered. */
	public static function next( string $from ): array {
		$graph = self::graph();
		return $graph[ $from ] ?? array();
	}

	/**
	 * What a target needs beyond the edge itself.
	 *
	 * Returned as keys rather than checked here, because checking them needs an
	 * order and this half has none. `guard()` and `transition()` resolve them.
	 *
	 * @return string[] any of: bat (an approved proof for the current version),
	 *                  production (the money a press needs), dispatch (the money
	 *                  a parcel needs).
	 */
	public static function needs( string $to ): array {
		switch ( $to ) {
			case self::PRODUCTION:
			case self::PRINTED:
				return array( 'bat', 'production' );
			case self::SHIPPED:
				// The proof again, and not only because production implies it:
				// `completed -> ts-prod -> ts-imprime -> ts-expedie` is the
				// reprint path, and a reprint of a superseded proof is the exact
				// mistake this whole chain exists to stop.
				return array( 'bat', 'dispatch' );
			case self::DELIVERED:
				return array( 'dispatch' );
			default:
				return array();
		}
	}

	/**
	 * Which settlement stage a target belongs to, or '' when money does not
	 * decide it. The names are `Settlement`'s, so there is one vocabulary.
	 */
	public static function stage( string $need ): string {
		if ( 'production' === $need ) {
			return Settlement::STAGE_PRODUCTION;
		}
		if ( 'dispatch' === $need ) {
			return Settlement::STAGE_DISPATCH;
		}
		return '';
	}

	/**
	 * Why an edge does not exist, in French, for the operator who tried it.
	 *
	 * A refusal that says "impossible" teaches nobody anything. This names both
	 * ends and, where there is one, the thing that has to happen first.
	 */
	public static function refusal( string $from, string $to ): string {
		$labels = self::statuses();
		$a      = $labels[ $from ] ?? $from;
		$b      = $labels[ $to ] ?? $to;

		if ( in_array( $to, array( self::PRODUCTION, self::PRINTED, self::SHIPPED ), true )
			&& ! in_array( $from, array( self::APPROVED, self::PRODUCTION, self::PRINTED, self::DELIVERED ), true ) ) {
			return sprintf(
				'Une commande « %1$s » ne peut pas passer à « %2$s » : la production suppose un BAT validé. Envoyez le BAT, puis attendez la validation du client.',
				$a,
				$b
			);
		}
		if ( self::DELIVERED === $to && self::SHIPPED !== $from ) {
			return sprintf( 'Une commande « %1$s » ne peut pas être marquée livrée : elle n’est pas encore expédiée.', $a );
		}
		if ( self::APPROVED === $to && self::PROOF !== $from ) {
			return sprintf( 'Une commande « %1$s » ne peut pas passer à « %2$s » : aucun BAT n’est en attente de réponse.', $a, $b );
		}
		return sprintf( 'Le passage de « %1$s » à « %2$s » n’existe pas dans le cycle de vie d’une commande.', $a, $b );
	}

	// ── WordPress ────────────────────────────────────────────────────────────

	public static function init(): void {
		/*
		 * BOTH REGISTRATIONS, and each alone fails silently. Without the post
		 * status wp-admin cannot list the orders; without `wc_order_statuses`,
		 * `set_status()` stores `pending` instead, because `WC_Abstract_Order`
		 * validates against `wc_get_order_statuses()` and never consults the
		 * post-status registry. Measured on the mirror by removing each in turn,
		 * and recorded in `Ledger` for its own status.
		 */
		add_filter( 'woocommerce_register_shop_order_post_statuses', array( self::class, 'register_statuses' ) );
		add_filter( 'wc_order_statuses', array( self::class, 'list_statuses' ) );

		/*
		 * THEY ARE NOT PAID STATUSES, AND THE FIRST VERSION OF THIS FILE HAD IT
		 * THE OTHER WAY. The argument for adding them was that an order on the
		 * press with its money banked is as paid as one in `processing`, and it
		 * cost two things that matter more than the reports.
		 *
		 *   THE DEFINITIVE INVOICE STOPPED BEING ISSUED. `Ledger::follow` calls
		 *   `payment_complete()` only `if ( ! $order->is_paid() )`, which is how
		 *   the balance of a deposit order produces its final invoice and its
		 *   commission. With `ts-bat` counted as paid, an order that took a
		 *   deposit and then received its balance was already "paid" and the
		 *   invoice was never issued at all.
		 *
		 *   AND EVERY ORDER COLLECTED NOTES ACCUSING ITSELF. `Ledger::on_status`
		 *   fires on any move into a paid status and writes an order note when
		 *   the balance is short; six moves down the lifecycle produced six.
		 *
		 * The doctrine this plugin already holds settles it: the ledger is the
		 * authority and the status is a label. `is_paid()` is a label-derived
		 * predicate, and teaching it to answer for our statuses was teaching a
		 * label to speak for the money. `Ledger` deliberately never added
		 * `ts-acompte` to this list either.
		 *
		 * AND THEY ARE NOT PAYABLE. `woocommerce_valid_order_statuses_for_payment`
		 * is what lights up the My Account "Payer" button and the pay link in
		 * WooCommerce's own e-mails, and every one of those surfaces charges the
		 * WHOLE `get_total()` again. `Ledger` records that trap for the deposit
		 * status. Nothing is added to it here either.
		 */

		/*
		 * OUT OF ANALYTICS UNTIL THE ORDER IS DELIVERED, for the reason
		 * `Ledger::out_of_reports` gives for the deposit status: Analytics books
		 * the ORDER total for any status not on its exclusion list, so a
		 * 5 472,00 EUR order sitting on a 2 736,00 EUR deposit booked the whole
		 * 5 472,00 EUR the moment its proof was sent, because the proof moved it
		 * out of `ts-acompte` and into a status nothing excluded.
		 *
		 * The exclusion list is a list of STATUSES and cannot ask the ledger, so
		 * the choice is between booking money that has not arrived and booking
		 * late. It books late: an order counts when it reaches `completed`, and
		 * what has actually been received is readable from the ledger at any
		 * time. Session 13's indicators read the ledger, not this.
		 */
		add_filter( 'woocommerce_analytics_excluded_order_statuses', array( self::class, 'out_of_reports' ) );

		add_filter( 'woocommerce_valid_order_statuses_for_payment_complete', array( self::class, 'completable' ) );

		// The guard. Priority 5, before anything that writes to the order in
		// the same pass, so a refused status is put back before it is read.
		add_action( 'woocommerce_before_order_object_save', array( self::class, 'guard' ), 5, 1 );

		add_action( 'admin_head', array( self::class, 'status_style' ) );
		add_action( 'admin_notices', array( self::class, 'refusal_notice' ) );
		add_action( 'add_meta_boxes', array( self::class, 'meta_box' ) );
		add_action( 'admin_post_' . self::ACTION_MOVE, array( self::class, 'handle_move' ) );
		add_action( 'admin_post_' . self::ACTION_TRACKING, array( self::class, 'handle_tracking' ) );
	}

	/** The admin action that moves an order, from the metabox. */
	public const ACTION_MOVE = 'teeshoop_cycle_move';

	/** Transient prefix holding the last refusal, so a redirect can show it. */
	private const REFUSAL_KEY = 'teeshoop_refus_';

	/** @param array $statuses WooCommerce's own shop_order post statuses. */
	public static function register_statuses( array $statuses ): array {
		foreach ( self::ours() as $slug ) {
			$label = self::statuses()[ $slug ];
			$statuses[ 'wc-' . $slug ] = array(
				'label'                     => $label,
				'public'                    => false,
				// FALSE on both, and load-bearing: `exclude_from_search => true`
				// drops the status out of `wc_get_orders( status => 'any' )`,
				// and `show_in_admin_all_list => false` hides these orders from
				// the list an operator actually works from.
				'exclude_from_search'       => false,
				'show_in_admin_all_list'    => true,
				'show_in_admin_status_list' => true,
				'label_count'               => _n_noop(
					$label . ' <span class="count">(%s)</span>',
					$label . ' <span class="count">(%s)</span>',
					'teeshoop'
				),
			);
		}
		return $statuses;
	}

	/** @param array<string,string> $statuses */
	public static function list_statuses( $statuses ): array {
		$statuses = (array) $statuses;
		foreach ( self::ours() as $slug ) {
			$statuses[ 'wc-' . $slug ] = self::statuses()[ $slug ];
		}
		return $statuses;
	}

	/** @param string[] $statuses */
	public static function out_of_reports( $statuses ): array {
		$statuses = array_merge( (array) $statuses, self::ours() );
		return array_values( array_unique( $statuses ) );
	}

	/**
	 * `payment_complete()` must be able to act from a status the order can
	 * legitimately be sitting in when the balance lands: an order can be waiting
	 * on artwork or on a proof with only a deposit banked.
	 *
	 * @param string[] $statuses
	 */
	public static function completable( $statuses ): array {
		$statuses = array_merge( (array) $statuses, array( self::WAIT, self::PROOF, self::CHANGES, self::APPROVED ) );
		return array_values( array_unique( $statuses ) );
	}

	/**
	 * What stops this order moving to `$to`, in French, or an empty list.
	 *
	 * THE ONE FUNCTION SESSION 07 CALLS. It reads records, never labels: the
	 * money from `Ledger` (which reads receipts) and the proof from `Bat`
	 * (which reads an approval against the CURRENT version). A status is a
	 * convenience for scanning a list and nothing rides on it.
	 *
	 * @return string[]
	 */
	public static function blockers( \WC_Order $order, string $to ): array {
		$out = array();
		foreach ( self::needs( $to ) as $need ) {
			if ( 'bat' === $need ) {
				$why = Bat::refusal( $order );
				if ( '' !== $why ) {
					$out[] = $why;
				}
				continue;
			}
			$stage = self::stage( $need );
			if ( '' !== $stage && ! Ledger::stage_allows( $order, $stage ) ) {
				/*
				 * THE SHORTFALL FOR THIS STAGE, NOT THE WHOLE BALANCE. A
				 * production stage is covered by whatever deposit somebody
				 * authorised, so on a 5 472,00 EUR order with 2 736,00 EUR
				 * authorised and 1 000,00 EUR received, what is missing before
				 * the press is 1 736,00 EUR. Printing the whole balance told the
				 * operator 4 472,00 EUR, which is what is missing before the
				 * PARCEL: a number four times too large for the decision in
				 * front of them, on the screen built to make that decision.
				 */
				$required = Settlement::required_for(
					$stage,
					Ledger::due( $order ),
					Ledger::authorised( $order ),
					Ledger::config()
				);
				$short = max( 0, $required - Ledger::received( $order ) );

				$out[] = Settlement::STAGE_DISPATCH === $stage
					? sprintf(
						'Le solde n’est pas encaissé : %s reste dû. Rien ne quitte l’atelier contre une promesse.',
						Money::format( $short )
					)
					: sprintf(
						'La production n’est pas couverte : %s reste dû sur ce qui a été autorisé.',
						Money::format( $short )
					);
			}
		}
		return $out;
	}

	/**
	 * Move an order, or say why not. THE ONLY API.
	 *
	 * Everything the shop's own code does goes through here, so a caller gets a
	 * real answer rather than a save that silently did nothing. `guard()` exists
	 * for everything that is not the shop's own code.
	 *
	 * @param array $ctx reason (string, what the operator typed), source
	 *                   (string, how it happened), actor (int, a user id).
	 *
	 * @return array{ok:bool,reason:string}
	 */
	public static function transition( \WC_Order $order, string $to, array $ctx = array() ): array {
		$from = $order->get_status();
		if ( $from === $to ) {
			return array(
				'ok'     => true,
				'reason' => '',
			);
		}
		if ( ! self::allowed( $from, $to ) ) {
			return array(
				'ok'     => false,
				'reason' => self::refusal( $from, $to ),
			);
		}
		$blockers = self::blockers( $order, $to );
		if ( ! empty( $blockers ) ) {
			return array(
				'ok'     => false,
				'reason' => implode( ' ', $blockers ),
			);
		}

		self::$authorised[ $order->get_id() ] = $to;
		self::remember( $order, $from, $to, $ctx );

		if ( self::CANCELLED === $to ) {
			$order->update_meta_data( self::META_CANCEL_STAGE, $from );
		}

		$order->set_status( $to );
		$order->save();

		return array(
			'ok'     => true,
			'reason' => '',
		);
	}

	/**
	 * Transitions this request already checked, keyed by order id.
	 *
	 * `transition()` has done the work by the time `guard()` sees the save, and
	 * repeating it would ask the ledger and the proof a second time for the same
	 * answer. It is a memo, not a permission: `guard()` still checks anything
	 * that is not in it, so a caller cannot get through by filling this in.
	 *
	 * @var array<int,string>
	 */
	private static array $authorised = array();

	/**
	 * The backstop, on every order save in the request.
	 *
	 * WHY HERE. `WC_Abstract_Order::set_status()` has no filter, so a transition
	 * cannot be vetoed where it is made. `woocommerce_before_order_object_save`
	 * runs after every change and before any of them is persisted, and it is the
	 * only place that sees all of them: the admin dropdown, a bulk action, our
	 * own code, WP-CLI, the REST API and any other plugin.
	 *
	 * WHY IT REVERTS RATHER THAN THROWS. `WC_Order::save()` wraps the whole
	 * thing in a try/catch that only logs, and then calls `status_transition()`
	 * regardless. A throw therefore produces an order that was NOT saved while
	 * every listener in the shop is told it moved, which is worse than the
	 * illegal status: the proof e-mail goes out, the workshop screen lights up,
	 * and the database disagrees with all of them. Putting the stored status
	 * back makes the write a no-op and makes the pending transition from-equals-to,
	 * so nothing downstream is told anything happened.
	 */
	public static function guard( $order ): void {
		if ( ! $order instanceof \WC_Order ) {
			return;
		}
		$id = $order->get_id();
		if ( $id <= 0 ) {
			// A new order has nothing stored to move away from.
			return;
		}

		$changes = $order->get_changes();
		if ( ! isset( $changes['status'] ) ) {
			return;
		}

		$to = self::bare( (string) $changes['status'] );
		// `get_data()` returns the STORED props; `get_changes()` returns the
		// pending ones. WooCommerce merges them in `get_status()`, so the only
		// way to see where the order actually is right now is to read the first.
		$data = $order->get_data();
		$from = self::bare( (string) ( $data['status'] ?? '' ) );

		if ( '' === $from || $from === $to ) {
			return;
		}
		// WordPress's own scaffolding states, none of which is a business one.
		foreach ( array( 'auto-draft', 'draft', 'trash', 'checkout-draft', 'new' ) as $scaffold ) {
			if ( $from === $scaffold || $to === $scaffold ) {
				return;
			}
		}

		if ( ( self::$authorised[ $id ] ?? '' ) === $to ) {
			unset( self::$authorised[ $id ] );
			return;
		}

		$reason = '';
		if ( ! self::allowed( $from, $to ) ) {
			$reason = self::refusal( $from, $to );
		} else {
			$blockers = self::blockers( $order, $to );
			if ( ! empty( $blockers ) ) {
				$reason = implode( ' ', $blockers );
			}
		}

		if ( '' === $reason ) {
			// Legal, and it came from somewhere that is not `transition()`:
			// WooCommerce moving an order itself, WP-CLI, another plugin. It is
			// allowed, and it is journalled, because "who and when" must hold
			// for every transition and not only for ours.
			if ( self::CANCELLED === $to ) {
				$order->update_meta_data( self::META_CANCEL_STAGE, $from );
			}
			self::remember( $order, $from, $to, array( 'source' => 'woocommerce' ) );
			return;
		}

		self::silence_woo_email( $from );
		$order->set_status( $from );

		/*
		 * AN ORDER NOTE, WHICH IS WHAT NOTES ARE FOR. They are reserved in this
		 * plugin for exceptions an operator must act on, and somebody just tried
		 * to ship an order that is not allowed to ship.
		 */
		$order->add_order_note(
			sprintf(
				/* translators: 1: the status that was refused, 2: why. */
				__( 'Changement de statut refusé (« %1$s ») : %2$s', 'teeshoop' ),
				self::statuses()[ $to ] ?? $to,
				$reason
			)
		);
		self::log( sprintf( 'refused %d %s -> %s: %s', $id, $from, $to, $reason ) );

		if ( function_exists( 'set_transient' ) ) {
			set_transient( self::REFUSAL_KEY . get_current_user_id(), $reason, 60 );
		}
	}

	/**
	 * Stop WooCommerce re-sending its own e-mail on the revert.
	 *
	 * `status_transition()` fires `woocommerce_order_status_{$to}` after the
	 * save, and the revert makes `$to` the status the order was already in. Of
	 * WooCommerce's own e-mail triggers only two are plain single-status hooks,
	 * `completed` and `failed`, so those are the two that would send a second
	 * copy of a message the customer already has. Both filters are its own
	 * public ones and both are removed as soon as the transition has fired.
	 */
	private static function silence_woo_email( string $from ): void {
		$map = array(
			self::DELIVERED => 'customer_completed_order',
			self::FAILED    => 'failed_order',
		);
		if ( ! isset( $map[ $from ] ) || ! function_exists( 'add_filter' ) ) {
			return;
		}
		$filter = 'woocommerce_email_enabled_' . $map[ $from ];
		add_filter( $filter, '__return_false', 99 );
		add_action(
			'woocommerce_order_status_changed',
			static function () use ( $filter ): void {
				remove_filter( $filter, '__return_false', 99 );
			},
			99
		);
	}

	/** Show the last refusal to whoever caused it. */
	public static function refusal_notice(): void {
		if ( ! function_exists( 'get_transient' ) ) {
			return;
		}
		$key    = self::REFUSAL_KEY . get_current_user_id();
		$reason = get_transient( $key );
		if ( ! is_string( $reason ) || '' === $reason ) {
			return;
		}
		delete_transient( $key );
		printf(
			'<div class="notice notice-error"><p><strong>%s</strong> %s</p></div>',
			esc_html__( 'Statut refusé :', 'teeshoop' ),
			esc_html( $reason )
		);
	}

	// ── the journal ──────────────────────────────────────────────────────────

	/**
	 * Write one transition down: what moved, when, and who moved it.
	 *
	 * NOT AN ORDER NOTE. Notes are read by operators as things to act on, and
	 * WooCommerce writes its own « Statut de la commande modifié » note for
	 * every change already. This is the machine-readable half: it is what a
	 * support conversation a year later is answered from, and what the customer
	 * timeline on the order screen is drawn from.
	 */
	private static function remember( \WC_Order $order, string $from, string $to, array $ctx ): void {
		$entry = array(
			'at'     => gmdate( 'c' ),
			'from'   => $from,
			'to'     => $to,
			'by'     => isset( $ctx['actor'] ) ? (int) $ctx['actor'] : ( function_exists( 'get_current_user_id' ) ? get_current_user_id() : 0 ),
			'reason' => isset( $ctx['reason'] ) ? mb_substr( (string) $ctx['reason'], 0, 400 ) : '',
			'source' => isset( $ctx['source'] ) ? (string) $ctx['source'] : 'teeshoop',
		);
		$entry['by_name'] = self::actor_name( $entry['by'] );

		$journal   = self::journal( $order );
		$journal[] = $entry;
		if ( count( $journal ) > self::JOURNAL_MAX ) {
			$journal = array_slice( $journal, -self::JOURNAL_MAX );
		}
		$order->update_meta_data( self::META_JOURNAL, wp_json_encode( $journal ) );
	}

	/**
	 * The order's transitions, oldest first.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public static function journal( \WC_Order $order ): array {
		$raw = (string) $order->get_meta( self::META_JOURNAL, true );
		if ( '' === $raw ) {
			return array();
		}
		$rows = json_decode( $raw, true );
		return is_array( $rows ) ? $rows : array();
	}

	/** Who did it, in a form that survives a deleted account. */
	private static function actor_name( int $id ): string {
		if ( $id <= 0 ) {
			return 'Système';
		}
		$user = function_exists( 'get_userdata' ) ? get_userdata( $id ) : false;
		return $user ? (string) $user->display_name : sprintf( 'Utilisateur %d', $id );
	}

	/** Strip WooCommerce's `wc-` post-status prefix. */
	private static function bare( string $status ): string {
		return 0 === strpos( $status, 'wc-' ) ? substr( $status, 3 ) : $status;
	}

	/** Colour the seven statuses in the order list, like WooCommerce's own. */
	public static function status_style(): void {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		$id     = $screen ? (string) $screen->id : '';
		if ( ! in_array( $id, array( 'edit-shop_order', 'woocommerce_page_wc-orders' ), true ) ) {
			return;
		}
		echo '<style>'
			. '.order-status.status-ts-attente,.order-status.status-ts-bat-mod{background:#f7e3c4;color:#5a3c00}'
			. '.order-status.status-ts-bat{background:#e6ecff;color:#1a2f6b}'
			. '.order-status.status-ts-bat-ok,.order-status.status-ts-prod{background:#d7ead9;color:#14401c}'
			. '.order-status.status-ts-imprime,.order-status.status-ts-expedie{background:#dfe4ea;color:#23282d}'
			. '</style>';
	}

	private static function log( string $message ): void {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( '[teeshoop] ' . $message ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		}
	}

	// ── the order screen ─────────────────────────────────────────────────────

	/**
	 * The box the workshop actually works from.
	 *
	 * IT EXISTS BECAUSE THE DROPDOWN CANNOT BE NARROWED. WooCommerce renders the
	 * status select from `wc_get_order_statuses()`, which is global and knows
	 * nothing about which order is on screen, so there is no honest way to show
	 * an operator only the moves this order can make. `guard()` refuses the
	 * wrong ones, and this offers the right ones: a button per legal move, and
	 * in place of a button, the sentence saying what has to happen first.
	 *
	 * The three-screen loop is `CostAdmin`'s, for the reason recorded there:
	 * the screen id differs under HPOS and legacy storage, and guarding the
	 * whole list on `function_exists` once registered the box on the screen
	 * nobody was looking at, with no error anywhere.
	 */
	public static function meta_box(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$screens = array( 'shop_order', 'woocommerce_page_wc-orders' );
		if ( function_exists( 'wc_get_page_screen_id' ) ) {
			$screens[] = wc_get_page_screen_id( 'shop-order' );
		}
		foreach ( array_unique( $screens ) as $screen ) {
			add_meta_box(
				'teeshoop-cycle',
				__( 'Suivi de commande', 'teeshoop' ),
				array( self::class, 'render_box' ),
				$screen,
				'side',
				'high'
			);
		}
	}

	/** @param mixed $post_or_order */
	public static function render_box( $post_or_order ): void {
		$order = $post_or_order instanceof \WC_Order ? $post_or_order : wc_get_order( $post_or_order );
		if ( ! $order instanceof \WC_Order ) {
			return;
		}
		$labels = self::statuses();
		$from   = $order->get_status();

		printf(
			'<p style="margin-top:0"><strong>%s</strong></p>',
			esc_html( $labels[ $from ] ?? $from )
		);

		$targets = array_values(
			array_filter(
				self::next( $from ),
				static fn( string $t ): bool => ! in_array( $t, array( self::CANCELLED, self::REFUNDED, self::PENDING, self::HOLD, self::FAILED ), true )
			)
		);

		if ( empty( $targets ) ) {
			printf( '<p class="description">%s</p>', esc_html__( 'Rien à faire depuis cet état.', 'teeshoop' ) );
		}

		foreach ( $targets as $to ) {
			$blockers = self::blockers( $order, $to );
			if ( ! empty( $blockers ) ) {
				printf(
					'<p style="margin:.6em 0"><span style="display:block;font-weight:600">%s</span><span class="description">%s</span></p>',
					esc_html( $labels[ $to ] ?? $to ),
					esc_html( implode( ' ', $blockers ) )
				);
				continue;
			}
			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="margin:.4em 0">';
			wp_nonce_field( self::ACTION_MOVE );
			printf( '<input type="hidden" name="action" value="%s">', esc_attr( self::ACTION_MOVE ) );
			printf( '<input type="hidden" name="order_id" value="%d">', (int) $order->get_id() );
			printf( '<input type="hidden" name="to" value="%s">', esc_attr( $to ) );
			printf(
				'<button type="submit" class="button">%s</button>',
				esc_html( sprintf( __( 'Passer à « %s »', 'teeshoop' ), $labels[ $to ] ?? $to ) )
			);
			echo '</form>';
		}

		self::tracking_form( $order );

		$journal = self::journal( $order );
		if ( empty( $journal ) ) {
			return;
		}
		echo '<hr><p style="margin-bottom:.4em"><strong>' . esc_html__( 'Historique', 'teeshoop' ) . '</strong></p>';
		echo '<ol style="margin:0;padding-left:1.2em;font-size:12px;line-height:1.5">';
		foreach ( array_reverse( $journal ) as $entry ) {
			printf(
				'<li>%1$s <span style="color:#646970">%2$s, %3$s</span>%4$s</li>',
				esc_html( $labels[ $entry['to'] ?? '' ] ?? (string) ( $entry['to'] ?? '' ) ),
				esc_html( self::human_date( (string) ( $entry['at'] ?? '' ) ) ),
				esc_html( (string) ( $entry['by_name'] ?? '' ) ),
				'' !== (string) ( $entry['reason'] ?? '' )
					? '<br><em>' . esc_html( (string) $entry['reason'] ) . '</em>'
					: ''
			);
		}
		echo '</ol>';
	}

	/**
	 * The carrier and the parcel number.
	 *
	 * TYPED, NOT FETCHED. There is no carrier API and question 14 has no answer,
	 * so what the shop knows is what somebody read off a label. Shown from the
	 * moment the run is printed, because that is when the parcel is packed and
	 * the number exists; asking for it only after the order is marked shipped
	 * would mean the dispatch e-mail always goes out without one.
	 */
	private static function tracking_form( \WC_Order $order ): void {
		if ( ! in_array( $order->get_status(), array( self::PRINTED, self::SHIPPED, self::DELIVERED ), true ) ) {
			return;
		}
		$tracking = Notify::tracking( $order );
		echo '<hr><form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( self::ACTION_TRACKING );
		printf( '<input type="hidden" name="action" value="%s">', esc_attr( self::ACTION_TRACKING ) );
		printf( '<input type="hidden" name="order_id" value="%d">', (int) $order->get_id() );
		printf( '<p><label for="ts-suivi">%s</label>', esc_html__( 'Numéro de suivi', 'teeshoop' ) );
		printf(
			'<input type="text" id="ts-suivi" name="suivi" class="widefat" value="%s" inputmode="latin" autocapitalize="characters"></p>',
			esc_attr( $tracking['number'] )
		);
		printf( '<p><label for="ts-transporteur">%s</label>', esc_html__( 'Transporteur', 'teeshoop' ) );
		printf(
			'<input type="text" id="ts-transporteur" name="transporteur" class="widefat" value="%s"></p>',
			esc_attr( $tracking['carrier'] )
		);
		printf( '<p><button type="submit" class="button">%s</button></p>', esc_html__( 'Enregistrer le suivi', 'teeshoop' ) );
		echo '</form>';
	}

	/** The admin action behind the tracking form. */
	public const ACTION_TRACKING = 'teeshoop_suivi';

	public static function handle_tracking(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de faire cela.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION_TRACKING );

		$order_id = isset( $_POST['order_id'] ) ? absint( wp_unslash( $_POST['order_id'] ) ) : 0;
		$order    = $order_id > 0 ? wc_get_order( $order_id ) : null;
		if ( ! $order instanceof \WC_Order ) {
			wp_die( esc_html__( 'Cette commande n’existe pas.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}
		$order->update_meta_data( Notify::META_TRACKING, isset( $_POST['suivi'] ) ? sanitize_text_field( wp_unslash( $_POST['suivi'] ) ) : '' );
		$order->update_meta_data( Notify::META_CARRIER, isset( $_POST['transporteur'] ) ? sanitize_text_field( wp_unslash( $_POST['transporteur'] ) ) : '' );
		$order->save();

		wp_safe_redirect( self::order_url( $order_id ) );
		exit;
	}

	/**
	 * An ISO instant as a Paris date a French reader meets.
	 *
	 * `F` AND NOT `M`. WordPress's fr_FR abbreviated months are capitalised
	 * ("Août"), and in French a month name is not: the proof read « 19 Août
	 * 2026 » on its own header. The full name comes out of `get_month()`, which
	 * is lowercase, and it reads better on a document anyway.
	 *
	 * `wp_date` and not `date`: the shop's own timezone decides the day, so an
	 * approval recorded at 00:30 Paris is not dated to the day before.
	 */
	public static function human_date( string $iso ): string {
		$ts = strtotime( $iso );
		if ( ! $ts ) {
			return $iso;
		}
		return function_exists( 'wp_date' ) ? (string) wp_date( 'j F Y à H:i', $ts ) : gmdate( 'j F Y H:i', $ts );
	}

	/** The metabox buttons. */
	public static function handle_move(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de faire cela.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION_MOVE );

		$order_id = isset( $_POST['order_id'] ) ? absint( wp_unslash( $_POST['order_id'] ) ) : 0;
		$to       = isset( $_POST['to'] ) ? sanitize_key( wp_unslash( $_POST['to'] ) ) : '';
		$order    = $order_id > 0 ? wc_get_order( $order_id ) : null;
		if ( ! $order instanceof \WC_Order ) {
			wp_die( esc_html__( 'Cette commande n’existe pas.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}

		$result = self::transition( $order, $to, array( 'source' => 'atelier' ) );
		if ( ! $result['ok'] ) {
			set_transient( self::REFUSAL_KEY . get_current_user_id(), $result['reason'], 60 );
		}

		wp_safe_redirect( self::order_url( $order_id ) );
		exit;
	}

	/** The order edit screen, under HPOS or the legacy post editor. */
	public static function order_url( int $order_id ): string {
		if ( class_exists( '\\Automattic\\WooCommerce\\Utilities\\OrderUtil' )
			&& \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled() ) {
			return admin_url( 'admin.php?page=wc-orders&action=edit&id=' . $order_id );
		}
		return admin_url( 'post.php?post=' . $order_id . '&action=edit' );
	}
}
