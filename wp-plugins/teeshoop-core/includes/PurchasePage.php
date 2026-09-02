<?php
/**
 * « Achats » : the screen where a human decides to spend money at a supplier.
 *
 * ── WHAT THIS SCREEN IS FOR, AND WHAT IT REFUSES TO BE ───────────────────────
 *
 * Question 22 asks whether supplier orders go out by themselves. The answer this
 * shop ships is the middle one: the basket is PREPARED automatically, from the
 * orders and their size grids, and a named human confirms it before anything
 * leaves. So this screen has exactly two writes that matter, and they are two
 * separate acts on two separate views:
 *
 *   1. « Préparer la commande fournisseur » freezes a basket. Nothing is sent,
 *      nothing is bought, and it can be undone.
 *   2. « Envoyer la commande » sends that frozen document, once.
 *
 * They are not one button with a confirmation dialog, because the thing a human
 * has to check is the DOCUMENT, and a dialog cannot show it. Between the two,
 * the operator is looking at every line, every quantity, the total, and the word
 * that says whether the supplier account is a rehearsal or real.
 *
 * ── THE CONFIRMATION IS TYPED, AND IT IS THE ACCOUNT MODE ────────────────────
 *
 * To send, the operator types the mode shown on screen. That is not ceremony: it
 * is the one fact that decides whether money moves, it is the fact question 22
 * says nobody is sure of, and it is sent to the Worker as what we BELIEVE. The
 * Worker reads the account's real mode and refuses if the two differ, so an
 * account switched to live between the screen and the click cannot turn this
 * confirmation into a real purchase. There is no JavaScript in this plugin's
 * admin screens and this needed none.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class PurchasePage {

	private const SLUG            = 'teeshoop-achats';
	private const ACTION_PREPARE  = 'teeshoop_achat_preparer';
	private const ACTION_SEND     = 'teeshoop_achat_envoyer';
	private const ACTION_DISCARD  = 'teeshoop_achat_annuler';
	private const ACTION_RECEIVE  = 'teeshoop_achat_recevoir';
	private const ACTION_ABANDON  = 'teeshoop_achat_abandonner';
	private const ACTION_EXPORT   = 'teeshoop_achat_exporter';

	public static function init(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ) );
		add_action( 'admin_post_' . self::ACTION_PREPARE, array( self::class, 'handle_prepare' ) );
		add_action( 'admin_post_' . self::ACTION_SEND, array( self::class, 'handle_send' ) );
		add_action( 'admin_post_' . self::ACTION_DISCARD, array( self::class, 'handle_discard' ) );
		add_action( 'admin_post_' . self::ACTION_RECEIVE, array( self::class, 'handle_receive' ) );
		add_action( 'admin_post_' . self::ACTION_ABANDON, array( self::class, 'handle_abandon' ) );
		add_action( 'admin_post_' . self::ACTION_EXPORT, array( self::class, 'handle_export' ) );
	}

	public static function menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Achats Teeshoop', 'teeshoop' ),
			__( 'Achats', 'teeshoop' ),
			'manage_woocommerce',
			self::SLUG,
			array( self::class, 'screen' )
		);
	}

	public static function url(): string {
		return admin_url( 'admin.php?page=' . self::SLUG );
	}

	// ── writes ───────────────────────────────────────────────────────────────

	private static function guard( string $action, string $what ): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html( sprintf( /* translators: %s: what the operator tried to do. */ __( 'Vous n’avez pas le droit de %s.', 'teeshoop' ), $what ) ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( $action );
	}

	private static function back( array $args ): void {
		wp_safe_redirect( add_query_arg( $args, self::url() ) );
		exit;
	}

	public static function handle_prepare(): void {
		self::guard( self::ACTION_PREPARE, __( 'préparer une commande fournisseur', 'teeshoop' ) );
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
		$lot_id = isset( $_POST['lot'] ) ? (int) $_POST['lot'] : 0;
		$lot    = Production::lot( $lot_id );
		if ( null === $lot ) {
			self::back( array( 'teeshoop_ko' => rawurlencode( __( 'Ce lot n’existe pas.', 'teeshoop' ) ) ) );
		}
		$ids = array();
		foreach ( (array) ( $lot['members'] ?? array() ) as $member ) {
			$ids[] = (int) ( $member['id'] ?? 0 );
		}
		$done = Purchase::prepare( $ids );
		self::back(
			$done['ok']
				? array( 'teeshoop_ok' => '1', 'achat' => (int) $done['id'] )
				: array( 'teeshoop_ko' => rawurlencode( $done['reason'] ) )
		);
	}

	public static function handle_send(): void {
		self::guard( self::ACTION_SEND, __( 'envoyer une commande fournisseur', 'teeshoop' ) );
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
		$id = isset( $_POST['achat'] ) ? (int) $_POST['achat'] : 0;
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
		$typed = isset( $_POST['confirmation'] ) ? strtolower( trim( sanitize_text_field( wp_unslash( (string) $_POST['confirmation'] ) ) ) ) : '';

		/*
		 * THE TYPED WORD IS THE BELIEF, and the belief is what gets checked.
		 * « réel » is what an operator reads on the screen; the supplier's own
		 * word is « live ». Mapping here rather than showing the English keeps
		 * the screen French without inventing a third vocabulary.
		 */
		$expect = '';
		if ( 'test' === $typed ) {
			$expect = 'test';
		} elseif ( in_array( $typed, array( 'reel', 'réel' ), true ) ) {
			$expect = 'live';
		}
		if ( '' === $expect ) {
			self::back(
				array(
					'achat'       => $id,
					'teeshoop_ko' => rawurlencode( __( 'Recopiez le mode du compte fournisseur pour confirmer : « test » ou « réel ». Rien n’a été envoyé.', 'teeshoop' ) ),
				)
			);
		}

		$done = Purchase::send( $id, $expect );
		self::back(
			$done['ok']
				? array( 'teeshoop_ok' => '1', 'achat' => $id )
				: array( 'teeshoop_ko' => rawurlencode( $done['reason'] ), 'achat' => $id )
		);
	}

	public static function handle_discard(): void {
		self::guard( self::ACTION_DISCARD, __( 'annuler une commande fournisseur', 'teeshoop' ) );
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
		$id   = isset( $_POST['achat'] ) ? (int) $_POST['achat'] : 0;
		$done = Purchase::discard( $id );
		self::back( $done['ok'] ? array( 'teeshoop_ok' => '1' ) : array( 'teeshoop_ko' => rawurlencode( $done['reason'] ) ) );
	}

	public static function handle_receive(): void {
		self::guard( self::ACTION_RECEIVE, __( 'enregistrer une réception', 'teeshoop' ) );
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
		$id   = isset( $_POST['achat'] ) ? (int) $_POST['achat'] : 0;
		$done = Purchase::receive( $id );
		self::back( $done['ok'] ? array( 'teeshoop_ok' => '1', 'achat' => $id ) : array( 'teeshoop_ko' => rawurlencode( $done['reason'] ), 'achat' => $id ) );
	}

	public static function handle_abandon(): void {
		self::guard( self::ACTION_ABANDON, __( 'déclarer une commande non reçue par le fournisseur', 'teeshoop' ) );
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
		$id   = isset( $_POST['achat'] ) ? (int) $_POST['achat'] : 0;
		$done = Purchase::abandon( $id );
		self::back( $done['ok'] ? array( 'teeshoop_ok' => '1', 'achat' => $id ) : array( 'teeshoop_ko' => rawurlencode( $done['reason'] ), 'achat' => $id ) );
	}

	/**
	 * The basket as a file, for a purchase nobody transmits.
	 *
	 * This is the whole of the « no automation » option, kept alive on purpose:
	 * it is what a second supplier's articles get (there is no route to them),
	 * and it is what the workshop falls back to on the day the Worker or the
	 * webservice is down. Semicolons and a BOM because the operator opens it in
	 * a French Excel, which reads a comma as a decimal separator.
	 */
	public static function handle_export(): void {
		self::guard( self::ACTION_EXPORT, __( 'exporter un panier d’achat', 'teeshoop' ) );
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
		$id       = isset( $_POST['achat'] ) ? (int) $_POST['achat'] : 0;
		$purchase = Purchase::get( $id );
		if ( null === $purchase ) {
			self::back( array( 'teeshoop_ko' => rawurlencode( __( 'Cette commande fournisseur n’existe pas.', 'teeshoop' ) ) ) );
		}

		nocache_headers();
		header( 'content-type: text/csv; charset=utf-8' );
		header( 'content-disposition: attachment; filename="achat-textile-' . $id . '.csv"' );
		echo "\xEF\xBB\xBF";
		$out = fopen( 'php://output', 'w' );
		fputcsv( $out, array( 'reference', 'coloris', 'taille', 'quantite', 'cout_unitaire_ht', 'montant_ht', 'commandes' ), ';' );
		foreach ( (array) $purchase['rows'] as $row ) {
			$refs = array();
			foreach ( (array) $row['from'] as $one ) {
				$refs[] = (string) $one['order_ref'] . ' x' . (int) $one['qty'];
			}
			fputcsv(
				$out,
				array(
					(string) $row['sku'],
					(string) $row['colour'],
					(string) $row['size'],
					(int) $row['qty'],
					null === $row['unit_ht'] ? '' : Money::number( Money::to_eur( (int) $row['unit_ht'] ), 2 ),
					null === $row['amount_ht'] ? '' : Money::number( Money::to_eur( (int) $row['amount_ht'] ), 2 ),
					implode( ' + ', $refs ),
				),
				';'
			);
		}
		fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- a stream, not a file.
		exit;
	}

	// ── the screen ───────────────────────────────────────────────────────────

	public static function screen(): void {
		echo '<div class="wrap">';
		echo '<h1>' . esc_html__( 'Achats', 'teeshoop' ) . '</h1>';

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a display-only flag.
		if ( isset( $_GET['teeshoop_ko'] ) ) {
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a display-only flag.
			echo '<div class="notice notice-error"><p>' . esc_html( sanitize_text_field( wp_unslash( (string) $_GET['teeshoop_ko'] ) ) ) . '</p></div>';
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a display-only flag.
		} elseif ( isset( $_GET['teeshoop_ok'] ) ) {
			echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__( 'C’est enregistré.', 'teeshoop' ) . '</p></div>';
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a display-only flag.
		$focus = isset( $_GET['achat'] ) ? (int) $_GET['achat'] : 0;
		if ( $focus > 0 && null !== Purchase::get( $focus ) ) {
			self::one_purchase( $focus );
			echo '<p><a href="' . esc_url( self::url() ) . '">' . esc_html__( '← Toutes les commandes fournisseur', 'teeshoop' ) . '</a></p></div>';
			return;
		}

		self::lots_to_buy();
		self::purchases_table();
		echo '</div>';
	}

	/** The lots whose blanks nobody has bought yet. */
	private static function lots_to_buy(): void {
		echo '<h2>' . esc_html__( 'Lots à approvisionner', 'teeshoop' ) . '</h2>';

		$lots = Production::lots( 30 );
		$open = array();
		foreach ( $lots as $lot ) {
			$ids = array();
			foreach ( (array) ( $lot['members'] ?? array() ) as $member ) {
				$ids[] = (int) ( $member['id'] ?? 0 );
			}
			$bought = false;
			foreach ( $ids as $id ) {
				$order = wc_get_order( $id );
				if ( $order instanceof \WC_Order && null !== Purchase::part_of( $order ) ) {
					$bought = true;
					break;
				}
			}
			if ( ! $bought && array() !== $ids ) {
				$open[] = array( $lot, $ids );
			}
		}

		if ( array() === $open ) {
			echo '<p>' . esc_html__( 'Aucun lot n’attend ses textiles : tous ceux qui sont constitués ont déjà une commande fournisseur. Un lot se crée depuis le studio, après imbrication.', 'teeshoop' ) . '</p>';
			return;
		}

		echo '<div style="overflow-x:auto;max-width:100%">';
		echo '<table class="widefat striped"><thead><tr>';
		foreach ( array( 'Lot', 'Commandes', 'Vêtements', 'Panier', 'Stock', '' ) as $head ) {
			echo '<th scope="col">' . esc_html( $head ) . '</th>';
		}
		echo '</tr></thead><tbody>';

		foreach ( $open as [ $lot, $ids ] ) {
			$basket = Purchase::basket( $ids );
			echo '<tr>';
			echo '<th scope="row">' . esc_html( sprintf( 'n° %d', (int) ( $lot['lot_id'] ?? 0 ) ) ) . '</th>';
			echo '<td>' . esc_html( (string) count( $ids ) ) . '</td>';
			echo '<td style="font-variant-numeric:tabular-nums;text-align:right">' . esc_html( (string) (int) ( $lot['garments'] ?? 0 ) ) . '</td>';
			echo '<td style="font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap">';
			echo $basket['complete']
				? esc_html( Money::format( (int) $basket['total_ht'] ) . ' HT' )
				: '<span class="description">' . esc_html__( 'non chiffrable', 'teeshoop' ) . '</span>';
			echo '</td>';
			echo '<td>' . esc_html( self::stock_phrase( $basket ) ) . '</td>';
			echo '<td>';
			if ( $basket['complete'] ) {
				self::form(
					self::ACTION_PREPARE,
					array( 'lot' => (int) ( $lot['lot_id'] ?? 0 ) ),
					__( 'Préparer la commande fournisseur', 'teeshoop' ),
					true
				);
			} else {
				echo '<span class="description">' . esc_html(
					$basket['ok'] ? __( 'des lignes ne sont pas identifiées', 'teeshoop' ) : __( 'panier impossible', 'teeshoop' )
				) . '</span>';
			}
			echo '</td></tr>';

			if ( ! $basket['complete'] ) {
				echo '<tr><td colspan="6"><ul style="list-style:disc;margin-left:1.5em">';
				/*
				 * A BASKET CAN FAIL WITHOUT ANY LINE FAILING: an order that has
				 * vanished, or the internal traceability check refusing. That
				 * reason was computed and then thrown away, and the row printed an
				 * empty list under « des lignes ne sont pas identifiées », which
				 * is a screen telling an operator to go and fix nothing.
				 */
				if ( '' !== (string) $basket['reason'] ) {
					echo '<li>' . esc_html( (string) $basket['reason'] ) . '</li>';
				}
				foreach ( (array) $basket['unresolved'] as $bad ) {
					echo '<li>' . esc_html( sprintf( '%s · %s : %s', (string) $bad['order_ref'], (string) $bad['label'], (string) $bad['why'] ) ) . '</li>';
				}
				echo '</ul></td></tr>';
			}
		}
		echo '</tbody></table></div>';
	}

	/** One prepared or sent purchase, in full: this is the confirmation screen. */
	private static function one_purchase( int $id ): void {
		$purchase = Purchase::get( $id );
		if ( null === $purchase ) {
			return;
		}
		$state  = (string) $purchase['state'];
		$states = Purchase::states();

		echo '<h2>' . esc_html( sprintf( /* translators: %d: a purchase number. */ __( 'Commande fournisseur n° %d', 'teeshoop' ), $id ) ) . '</h2>';
		echo '<p><strong>' . esc_html( $states[ $state ] ?? $state ) . '</strong>';
		echo ' · ' . esc_html( sprintf( /* translators: %s: our own reference for this purchase. */ __( 'référence %s', 'teeshoop' ), (string) $purchase['key'] ) );
		if ( '' !== (string) $purchase['sent_on'] ) {
			echo ' · ' . esc_html( sprintf( /* translators: %s: a date. */ __( 'envoyée le %s', 'teeshoop' ), Production::fr_date( (string) $purchase['sent_on'] ) ) );
		}
		echo '</p>';

		if ( Purchase::PARTIAL === $state ) {
			echo '<div class="notice notice-error"><p>' . esc_html__( 'Le fournisseur a créé la commande mais REFUSÉ des lignes : la série sera incomplète. Les articles refusés sont détaillés ci-dessous ; ils ne seront pas livrés, et la presse ne pourra pas tourner sur les vêtements manquants.', 'teeshoop' ) . '</p></div>';
		}

		if ( Purchase::UNCERTAIN === $state ) {
			echo '<div class="notice notice-error"><p>' . esc_html__( 'Le fournisseur n’a pas répondu à cet envoi. La commande a peut-être été créée chez lui. Vérifiez sur son site avant toute nouvelle tentative : rien ne sera renvoyé automatiquement d’ici, parce qu’un second envoi serait une seconde livraison à payer.', 'teeshoop' ) . '</p>';
			echo '<p>' . esc_html__( 'Une fois la vérification faite, dites laquelle des deux : « Marquer les textiles reçus » si la livraison arrive, « Le fournisseur n’a rien reçu » si sa commande n’existe pas, ce qui rend ces commandes achetables de nouveau.', 'teeshoop' ) . '</p></div>';
		}
		/*
		 * WHAT THE SUPPLIER SAID, ALWAYS. This used to be hidden on an accepted
		 * order, on the reasoning that a success needs no explanation, and an
		 * order accepted WITH refused lines is stored with those refusals and was
		 * therefore silent about exactly the case that costs a run.
		 */
		if ( is_array( $purchase['answer'] ?? null ) && '' !== Purchase::answer_fr( $purchase['answer'] ) ) {
			echo '<div class="notice notice-warning inline"><p>' . esc_html( Purchase::answer_fr( $purchase['answer'] ) ) . '</p></div>';
		}

		self::rows_table( $purchase );
		self::short_table( $purchase );
		self::orders_table( $purchase );
		self::actions( $purchase );
	}

	/** What is being bought. */
	private static function rows_table( array $purchase ): void {
		echo '<h3>' . esc_html__( 'Le panier', 'teeshoop' ) . '</h3>';
		echo '<div style="overflow-x:auto;max-width:100%">';
		echo '<table class="widefat striped"><thead><tr>';
		foreach ( array( 'Article', 'Coloris', 'Taille', 'Quantité', 'Coût unitaire HT', 'Montant HT', 'Stock', 'Commandes' ) as $head ) {
			echo '<th scope="col">' . esc_html( $head ) . '</th>';
		}
		echo '</tr></thead><tbody>';

		$num = 'style="font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap"';
		foreach ( (array) $purchase['rows'] as $row ) {
			$refs = array();
			foreach ( (array) $row['from'] as $one ) {
				$refs[] = sprintf( '%s (%d)', (string) $one['order_ref'], (int) $one['qty'] );
			}
			echo '<tr>';
			echo '<th scope="row">' . esc_html( (string) $row['sku'] ) . '</th>';
			echo '<td>' . esc_html( (string) $row['colour'] ) . '</td>';
			echo '<td>' . esc_html( (string) $row['size'] ) . '</td>';
			echo '<td ' . $num . '>' . esc_html( (string) (int) $row['qty'] ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- $num is a literal above.
			echo '<td ' . $num . '>' . esc_html( null === $row['unit_ht'] ? '—' : Money::format( (int) $row['unit_ht'] ) ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '<td ' . $num . '>' . esc_html( null === $row['amount_ht'] ? '—' : Money::format( (int) $row['amount_ht'] ) ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '<td ' . $num . '>' . esc_html( self::stock_cell( $row ) ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '<td class="description">' . esc_html( implode( ' + ', $refs ) ) . '</td>';
			echo '</tr>';
		}

		echo '</tbody></table></div>';

		/*
		 * THE TOTALS ARE OUTSIDE THE TABLE, and that is a mobile decision made by
		 * looking at the screen at 375 px rather than by reasoning about it. As a
		 * `tfoot` they sat in the horizontally scrolling region: the label « À
		 * payer au fournisseur » was visible with an empty cell beside it and the
		 * amount two screens to the right. The three figures that decide whether
		 * to press the button cannot be the ones you have to go looking for.
		 */
		echo '<table class="widefat" style="max-width:34em;margin-top:.6em"><tbody>';
		self::total_row( __( 'Textiles', 'teeshoop' ), Money::format( (int) $purchase['blanks_ht'] ), sprintf( /* translators: %d: how many garments. */ _n( '%d pièce', '%d pièces', (int) $purchase['garments'], 'teeshoop' ), (int) $purchase['garments'] ) );
		self::total_row(
			__( 'Port fournisseur', 'teeshoop' ),
			Money::format( (int) $purchase['freight_ht'] ),
			// The threshold itself is question 03's written default, not a tariff
			// anybody has confirmed, so neither branch may state it as a fact.
			0 === (int) $purchase['freight_ht']
				? __( 'franco supposé atteint, question 03 à confirmer', 'teeshoop' )
				: __( 'question 03, à confirmer', 'teeshoop' )
		);
		self::total_row( __( 'À payer au fournisseur', 'teeshoop' ), Money::format( (int) $purchase['total_ht'] ) . ' HT', '', true );
		echo '</tbody></table>';
	}

	/** One line of the summary under the basket. */
	private static function total_row( string $label, string $amount, string $note, bool $strong = false ): void {
		echo '<tr><th scope="row" style="width:14em">' . esc_html( $label ) . '</th>';
		echo '<td style="font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap">';
		echo $strong ? '<strong>' . esc_html( $amount ) . '</strong>' : esc_html( $amount );
		echo '</td><td class="description">' . esc_html( $note ) . '</td></tr>';
	}

	/**
	 * What the supplier does not have enough of, and when he says it comes back.
	 *
	 * The restock date is HIS announcement, not our estimate: nobody has measured
	 * how long he takes to deliver (question 46), so this file prints the only
	 * forward-looking fact that exists and computes none of its own.
	 */
	private static function short_table( array $purchase ): void {
		$short = (array) ( $purchase['stock']['short'] ?? array() );
		if ( array() === $short ) {
			return;
		}
		echo '<h3>' . esc_html__( 'Ce qui manque chez le fournisseur', 'teeshoop' ) . '</h3>';
		echo '<p class="description" style="max-width:46em">' . esc_html__( 'Un relevé de stock est une observation datée, jamais une réservation : le fournisseur sert d’autres clients entre le relevé et la commande. Ces lignes partiront quand même, et il dira ce qu’il peut servir.', 'teeshoop' ) . '</p>';
		echo '<div style="overflow-x:auto;max-width:100%"><table class="widefat striped"><thead><tr>';
		foreach ( array( 'Article', 'Coloris', 'Taille', 'Demandé', 'En stock', 'Réapprovisionnement annoncé' ) as $head ) {
			echo '<th scope="col">' . esc_html( $head ) . '</th>';
		}
		echo '</tr></thead><tbody>';
		$num = 'style="font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap"';
		foreach ( $short as $one ) {
			echo '<tr><th scope="row">' . esc_html( (string) $one['sku'] ) . '</th>';
			echo '<td>' . esc_html( (string) $one['colour'] ) . '</td>';
			echo '<td>' . esc_html( (string) $one['size'] ) . '</td>';
			echo '<td ' . $num . '>' . esc_html( (string) (int) $one['want'] ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- a literal above.
			echo '<td ' . $num . '>' . esc_html( (string) (int) $one['have'] ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '<td>';
			echo '' !== (string) ( $one['back_on'] ?? '' )
				? esc_html( sprintf( /* translators: 1: a date, 2: how many pieces. */ __( 'le %1$s, %2$d pièces', 'teeshoop' ), Production::fr_date( (string) $one['back_on'] ), (int) ( $one['back_qty'] ?? 0 ) ) )
				: '<span class="description">' . esc_html__( 'rien d’annoncé', 'teeshoop' ) . '</span>';
			echo '</td></tr>';
		}
		echo '</tbody></table></div>';
	}

	/** What each customer order contributes, and what it was assumed to cost. */
	private static function orders_table( array $purchase ): void {
		echo '<h3>' . esc_html__( 'Par commande', 'teeshoop' ) . '</h3>';
		echo '<p class="description" style="max-width:46em">' . esc_html__( 'L’écart compare ce que les textiles coûtent aujourd’hui à ce que le rapport de marge de la commande avait supposé. Un fournisseur qui augmente un t-shirt de huit centimes ne se voit nulle part et déplace tous les prix planchers.', 'teeshoop' ) . '</p>';
		/*
		 * READ, NOT WRITTEN. This sentence carried the number 2 in its own text
		 * while `Production::config()['blank_days']` decided the date beside it,
		 * so an operator changing the supplier lead time would have moved the
		 * column and not the sentence that explains it. The row that owns the
		 * value declares no mirror and no literal, so no guard could see the
		 * second copy: only reading it removes it.
		 */
		echo '<p class="description" style="max-width:46em">' . esc_html(
			sprintf(
				/* translators: %d: working days the supplier takes to deliver blanks. */
				_n(
					'« Blancs à commander avant » est la date au-delà de laquelle les vêtements nus n’arriveront plus à temps : elle retient %d jour ouvré d’approvisionnement, puis le pressage, le battement d’atelier et l’acheminement. Une case vide veut dire que le bon à tirer n’est pas validé, donc que le compte à rebours n’a pas commencé.',
					'« Blancs à commander avant » est la date au-delà de laquelle les vêtements nus n’arriveront plus à temps : elle retient %d jours ouvrés d’approvisionnement, puis le pressage, le battement d’atelier et l’acheminement. Une case vide veut dire que le bon à tirer n’est pas validé, donc que le compte à rebours n’a pas commencé.',
					(int) ( Production::config()['blank_days'] ?? 0 ),
					'teeshoop'
				),
				(int) ( Production::config()['blank_days'] ?? 0 )
			)
		) . '</p>';
		echo '<div style="overflow-x:auto;max-width:100%">';
		echo '<table class="widefat striped"><thead><tr>';
		foreach ( array( 'Commande', 'Client', 'Vêtements', 'Blancs à commander avant', 'Textiles HT', 'Supposé HT', 'Écart', 'Port seul', 'Part du port' ) as $head ) {
			echo '<th scope="col">' . esc_html( $head ) . '</th>';
		}
		echo '</tr></thead><tbody>';

		$num = 'style="font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap"';
		foreach ( (array) $purchase['orders'] as $row ) {
			$delta = $row['delta_ht'];
			echo '<tr>';
			echo '<th scope="row"><a href="' . esc_url( admin_url( 'post.php?post=' . (int) $row['id'] . '&action=edit' ) ) . '">' . esc_html( (string) $row['ref'] ) . '</a></th>';
			echo '<td>' . esc_html( (string) $row['customer'] ) . '</td>';
			echo '<td ' . $num . '>' . esc_html( (string) (int) $row['garments'] ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '<td style="white-space:nowrap">';
			$by = (string) ( $row['blank_by'] ?? '' );
			echo '' !== $by
				? esc_html( Production::fr_date( $by ) )
				: '<span class="description">' . esc_html__( 'bon à tirer non validé', 'teeshoop' ) . '</span>';
			echo '</td>';
			echo '<td ' . $num . '>' . esc_html( Money::format( (int) $row['blanks_ht'] ) ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '<td ' . $num . '>' . esc_html( null === $row['assumed_ht'] ? '—' : Money::format( (int) $row['assumed_ht'] ) ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '<td ' . $num . '>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			if ( null === $delta ) {
				echo '<span class="description">' . esc_html__( 'jamais chiffrée', 'teeshoop' ) . '</span>';
			} elseif ( 0 === (int) $delta ) {
				echo esc_html__( 'aucun', 'teeshoop' );
			} else {
				echo '<strong>' . esc_html( ( $delta > 0 ? '+' : '−' ) . Money::format( abs( (int) $delta ) ) ) . '</strong>';
			}
			echo '</td>';
			echo '<td ' . $num . '>' . esc_html( Money::format( (int) $row['solo_freight_ht'] ) ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '<td ' . $num . '>' . esc_html( Money::format( (int) $row['freight_ht'] ) ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '</tr>';
		}
		echo '</tbody></table></div>';
	}

	/** The buttons, and the one that spends money. */
	private static function actions( array $purchase ): void {
		$id    = (int) $purchase['purchase_id'];
		$state = (string) $purchase['state'];

		echo '<h3>' . esc_html__( 'Ce qu’il reste à faire', 'teeshoop' ) . '</h3>';

		if ( Purchase::PREPARED === $state ) {
			$mode = Supply::mode();
			echo '<div style="border:1px solid #c3c4c7;background:#fff;padding:1em;max-width:46em">';

			if ( 'live' === $mode['mode'] ) {
				echo '<p class="notice notice-error" style="margin:0 0 1em;padding:.6em"><strong>' . esc_html__( 'Le compte fournisseur est en mode réel : cette commande sera une vraie commande, livrée et facturée.', 'teeshoop' ) . '</strong></p>';
			} elseif ( 'test' === $mode['mode'] ) {
				echo '<p class="notice notice-warning inline" style="margin:0 0 1em;padding:.6em">' . esc_html__( 'Le compte fournisseur est en mode test : rien de réel ne sera commandé.', 'teeshoop' ) . '</p>';
			} else {
				echo '<p class="notice notice-error" style="margin:0 0 1em;padding:.6em">' . esc_html( sprintf( /* translators: %s: why the account mode could not be read. */ __( 'Le mode du compte fournisseur n’a pas pu être lu (%s). Rien ne peut être envoyé tant que ce point n’est pas clair.', 'teeshoop' ), $mode['error'] ) ) . '</p>';
			}

			if ( 'unknown' !== $mode['mode'] ) {
				$word = 'live' === $mode['mode'] ? 'réel' : 'test';
				echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
				wp_nonce_field( self::ACTION_SEND );
				echo '<input type="hidden" name="action" value="' . esc_attr( self::ACTION_SEND ) . '">';
				echo '<input type="hidden" name="achat" value="' . esc_attr( (string) $id ) . '">';
				echo '<p><label for="teeshoop-confirmation">' . esc_html( sprintf( /* translators: %s: the word to copy, "test" or "réel". */ __( 'Pour envoyer, recopiez le mode du compte : %s', 'teeshoop' ), $word ) ) . '</label><br>';
				echo '<input type="text" id="teeshoop-confirmation" name="confirmation" autocomplete="off" required style="width:12em"></p>';
				echo '<p class="description">' . esc_html__( 'Le mode est relu au moment de l’envoi. S’il a changé depuis cet écran, la commande est refusée et rien ne part.', 'teeshoop' ) . '</p>';
				echo '<p><button type="submit" class="button button-primary">' . esc_html__( 'Envoyer la commande au fournisseur', 'teeshoop' ) . '</button></p>';
				echo '</form>';
			}

			echo '</div><p>';
			self::form( self::ACTION_EXPORT, array( 'achat' => $id ), __( 'Exporter le panier (CSV)', 'teeshoop' ), false );
			self::form( self::ACTION_DISCARD, array( 'achat' => $id ), __( 'Annuler cette préparation', 'teeshoop' ), false, true );
			echo '</p>';
			return;
		}

		echo '<p>';
		self::form( self::ACTION_EXPORT, array( 'achat' => $id ), __( 'Exporter le panier (CSV)', 'teeshoop' ), false );
		if ( in_array( $state, array( Purchase::SENT, Purchase::UNCERTAIN ), true ) ) {
			self::form( self::ACTION_RECEIVE, array( 'achat' => $id ), __( 'Marquer les textiles reçus', 'teeshoop' ), true );
		}
		/*
		 * THE ONLY WAY OUT OF « ENVOI INCERTAIN », and it is a human assertion
		 * rather than a check the shop can make: this supplier publishes no route
		 * that lists orders. Without it those orders stay pinned to a purchase
		 * that may not exist, and their blanks can never be bought.
		 */
		if ( Purchase::UNCERTAIN === $state ) {
			self::form( self::ACTION_ABANDON, array( 'achat' => $id ), __( 'Le fournisseur n’a rien reçu', 'teeshoop' ), false );
		}
		echo '</p>';

		if ( Purchase::RECEIVED === $state ) {
			echo '<p class="description" style="max-width:46em">' . esc_html__( 'Le rapprochement avec la facture du fournisseur n’est pas construit : son interface ne publie aucune facture. Ce que cet écran compare, c’est le coût supposé au moment du chiffrage et le coût au moment de l’achat.', 'teeshoop' ) . '</p>';
		}
	}

	/** The list of purchases. */
	private static function purchases_table(): void {
		echo '<h2>' . esc_html__( 'Commandes fournisseur', 'teeshoop' ) . '</h2>';
		$all = Purchase::recent( 20 );
		if ( array() === $all ) {
			echo '<p>' . esc_html__( 'Aucune commande fournisseur n’a encore été préparée. Une commande fournisseur achète les textiles de tout un lot en une fois : un seul port, une seule livraison.', 'teeshoop' ) . '</p>';
			return;
		}

		echo '<div style="overflow-x:auto;max-width:100%">';
		echo '<table class="widefat striped"><thead><tr>';
		foreach ( array( 'N°', 'État', 'Préparée le', 'Commandes', 'Vêtements', 'Total HT', '' ) as $head ) {
			echo '<th scope="col">' . esc_html( $head ) . '</th>';
		}
		echo '</tr></thead><tbody>';
		$states = Purchase::states();
		$num    = 'style="font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap"';
		foreach ( $all as $one ) {
			echo '<tr>';
			echo '<th scope="row">' . esc_html( (string) (int) $one['purchase_id'] ) . '</th>';
			echo '<td>' . esc_html( $states[ (string) $one['state'] ] ?? (string) $one['state'] ) . '</td>';
			echo '<td>' . esc_html( Production::fr_date( (string) $one['created_on'] ) ) . '</td>';
			echo '<td ' . $num . '>' . esc_html( (string) count( (array) $one['orders'] ) ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '<td ' . $num . '>' . esc_html( (string) (int) $one['garments'] ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '<td ' . $num . '>' . esc_html( Money::format( (int) $one['total_ht'] ) ) . '</td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			echo '<td><a href="' . esc_url( add_query_arg( 'achat', (int) $one['purchase_id'], self::url() ) ) . '">' . esc_html__( 'Ouvrir', 'teeshoop' ) . '</a></td>';
			echo '</tr>';
		}
		echo '</tbody></table></div>';
	}

	// ── small things ─────────────────────────────────────────────────────────

	/** One button, its own POST form, the idiom `ProductionPage` uses. */
	private static function form( string $action, array $fields, string $label, bool $primary, bool $link = false ): void {
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="display:inline-block;margin-right:.6em">';
		wp_nonce_field( $action );
		echo '<input type="hidden" name="action" value="' . esc_attr( $action ) . '">';
		foreach ( $fields as $name => $value ) {
			echo '<input type="hidden" name="' . esc_attr( (string) $name ) . '" value="' . esc_attr( (string) $value ) . '">';
		}
		$class = $link ? 'button-link' : ( $primary ? 'button button-primary' : 'button' );
		echo '<button type="submit" class="' . esc_attr( $class ) . '">' . esc_html( $label ) . '</button>';
		echo '</form>';
	}

	/** One line about the stock behind a whole basket. */
	private static function stock_phrase( array $basket ): string {
		$stock = (array) $basket['stock'];
		if ( array() !== (array) $stock['short'] ) {
			return sprintf(
				/* translators: %d: how many articles the supplier does not have enough of. */
				_n( '%d article manquant', '%d articles manquants', count( (array) $stock['short'] ), 'teeshoop' ),
				count( (array) $stock['short'] )
			);
		}
		if ( empty( $stock['trusted'] ) ) {
			return __( 'relevé trop ancien', 'teeshoop' );
		}
		return __( 'disponible', 'teeshoop' );
	}

	/**
	 * One cell about the stock behind one article.
	 *
	 * FOUR STATES AND NOT TWO, because the first version had two and lied. It
	 * printed « trop ancien » about a reading four minutes old, on a shop whose
	 * WordPress runs on UTC while the supplier writes his own wall clock: a
	 * timestamp from the future is not an old timestamp, and an operator told his
	 * data is stale goes and refreshes something that was never stale.
	 */
	private static function stock_cell( array $row ): string {
		if ( null === $row['stock'] ) {
			return __( 'inconnu', 'teeshoop' );
		}
		switch ( Purchase::freshness( (string) $row['stock_at'] ) ) {
			case 'unknown':
				return __( 'sans relevé', 'teeshoop' );
			case 'stale':
				return __( 'trop ancien', 'teeshoop' );
			case 'future':
				return __( 'horloges décalées', 'teeshoop' );
		}
		if ( (int) $row['stock'] < (int) $row['qty'] ) {
			/* translators: %d: how many the supplier has, when it is fewer than we need. */
			return sprintf( __( '%d seulement', 'teeshoop' ), (int) $row['stock'] );
		}
		return __( 'en stock', 'teeshoop' );
	}
}
