<?php
/**
 * Une réclamation: what went wrong, whose fault it was, and what we owe.
 *
 * THE MINIMUM, AND DELIBERATELY THE MINIMUM. Chapitre 5 describes a full SAV
 * module: eleven motifs, a customer form with photographs, an SLA, a cost per
 * dossier reconciled against the supplier, a weekly quality report. Most of that
 * is a CRM and a production system, and `QUESTIONS-ASSOCIE.md` records that we
 * buy a CRM rather than build one. What is built here is the part nothing else
 * can hold: a claim ATTACHED TO THE ORDER, so the person answering can see in
 * one screen whether we owe a reprint.
 *
 * AND THAT QUESTION HAS A RULE. Chapitre 5's own decision matrix says who pays
 * for what, and `verdict()` is that table and nothing more. It is here rather
 * than in somebody's head because « le traitement au cas par cas reste possible,
 * mais il doit partir d'une règle afin d'éviter les décisions incohérentes »,
 * and because the answer to « erreur validée dans le BAT » depends on evidence
 * this plugin is the only thing holding: which version was approved, when, and
 * by whom.
 *
 * IT DECIDES NOTHING BY ITSELF. `verdict()` returns what the matrix says and the
 * human decides; nothing is refunded, replaced or credited by this file. A SAV
 * module that issued avoirs on a dropdown would be a way to move money with one
 * click and no second pair of eyes.
 *
 * THE PURE HALF (`causes`, `motifs`, `verdict`) calls no WordPress function and
 * is tested by `php tests/run.php`.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Claim {

	/** Order meta: every claim on this order, oldest first, JSON. */
	public const META = '_teeshoop_reclamations';

	public const ACTION_OPEN  = 'teeshoop_sav_ouvrir';
	public const ACTION_CLOSE = 'teeshoop_sav_decider';

	/** How long a description may be. Bounded because it is stored. */
	private const TEXT_MAX = 4000;

	// ── the rule, pure ───────────────────────────────────────────────────────

	/**
	 * Why it went wrong. Chapitre 5's own list of causes, verbatim.
	 *
	 * @return array<string,string>
	 */
	public static function causes(): array {
		return array(
			'teeshoop'    => 'Erreur Teeshoop',
			'fournisseur' => 'Défaut fournisseur',
			'transport'   => 'Dommage transport',
			'bat'         => 'Erreur validée dans le BAT',
			'taille'      => 'Mauvaise taille commandée par le client',
			'entretien'   => 'Usure ou entretien inadapté',
		);
	}

	/**
	 * What the customer says is wrong. Chapitre 5's motifs.
	 *
	 * @return array<string,string>
	 */
	public static function motifs(): array {
		return array(
			'quantite'  => 'Quantité',
			'taille'    => 'Taille',
			'couleur'   => 'Couleur',
			'produit'   => 'Produit',
			'textile'   => 'Défaut textile',
			'marquage'  => 'Défaut de marquage',
			'position'  => 'Position du marquage',
			'fichier'   => 'Fichier',
			'colis'     => 'Colis',
			'delai'     => 'Délai',
			'autre'     => 'Autre',
		);
	}

	/**
	 * What the matrix says, given a cause.
	 *
	 * `owed` is the load-bearing half: whether Teeshoop pays. It is what the
	 * screen colours and what a later session would count in a SAV cost, and it
	 * is deliberately a boolean with a `null` for the two cases the matrix
	 * itself leaves open: a « geste éventuel » and a « solution commerciale
	 * possible » are decisions, not entitlements, and reporting either as owed
	 * or as not owed would be putting words in the associate's mouth.
	 *
	 * @return array{solution:string,owed:?bool,note:string}
	 */
	public static function verdict( string $cause ): array {
		switch ( $cause ) {
			case 'teeshoop':
				return array(
					'solution' => 'Remplacement prioritaire, avoir ou remboursement',
					'owed'     => true,
					'note'     => 'La faute est la nôtre : le client ne paie rien et passe devant.',
				);
			case 'fournisseur':
				return array(
					'solution' => 'Remplacement, et recours auprès du fournisseur',
					'owed'     => true,
					'note'     => 'Le client est refait tout de suite ; le recours est notre affaire, pas la sienne.',
				);
			case 'transport':
				return array(
					'solution' => 'Dossier transporteur, remplacement selon l’urgence',
					'owed'     => true,
					'note'     => 'Photographier le colis avant toute chose : sans photo, le transporteur refuse.',
				);
			case 'bat':
				return array(
					'solution' => 'Pas de gratuité automatique, geste éventuel',
					'owed'     => null,
					'note'     => 'Ce que le client a validé fait foi. La version, la date et l’adresse sont sur la commande.',
				);
			case 'taille':
				return array(
					'solution' => 'Pas de reprise, solution commerciale possible',
					'owed'     => null,
					'note'     => 'Un vêtement personnalisé ne peut pas être remis en vente : reprendre, c’est le jeter.',
				);
			case 'entretien':
				return array(
					'solution' => 'Analyse et conseil',
					'owed'     => false,
					'note'     => 'Regarder l’étiquette et la façon dont il a été lavé avant de conclure.',
				);
		}
		/*
		 * A CAUSE NOBODY HAS CHOSEN IS NOT A CAUSE THAT COSTS NOTHING. The safe
		 * answer to "we have not decided" is "we do not know", never "the
		 * customer is wrong": the second is a refusal, and it would be a refusal
		 * this table never actually made.
		 */
		return array(
			'solution' => 'À qualifier',
			'owed'     => null,
			'note'     => 'Tant que la cause n’est pas choisie, la matrice du chapitre 5 ne dit rien de ce dossier.',
		);
	}

	// ── WordPress ────────────────────────────────────────────────────────────

	public static function init(): void {
		add_action( 'add_meta_boxes', array( self::class, 'meta_box' ) );
		add_action( 'admin_post_' . self::ACTION_OPEN, array( self::class, 'handle_open' ) );
		add_action( 'admin_post_' . self::ACTION_CLOSE, array( self::class, 'handle_close' ) );
	}

	/** @return array<int,array<string,mixed>> */
	public static function all( \WC_Order $order ): array {
		$raw = (string) $order->get_meta( self::META, true );
		if ( '' === $raw ) {
			return array();
		}
		$rows = json_decode( $raw, true );
		return is_array( $rows ) ? $rows : array();
	}

	/**
	 * Open a claim on this order.
	 *
	 * WHAT IT LINKS, AND WHY EACH. The proof version that was approved and when,
	 * because « erreur validée dans le BAT » is a row of the matrix and it is
	 * decided by that record and nothing else. The lifecycle the order had
	 * reached, because a complaint about a delay on an order still waiting for
	 * its own approval is a different conversation. Both are FROZEN onto the
	 * claim: an order goes on moving, and a dossier answered in six months has
	 * to say what was true when it was opened.
	 *
	 * @return array{ok:bool,claim?:array,reason?:string}
	 */
	public static function open( \WC_Order $order, string $motif, string $description, int $quantity = 0 ): array {
		$description = trim( $description );
		if ( ! isset( self::motifs()[ $motif ] ) ) {
			return array(
				'ok'     => false,
				'reason' => 'Choisissez un motif : sans lui, le dossier ne peut être ni compté ni comparé.',
			);
		}
		if ( mb_strlen( $description ) < 10 ) {
			return array(
				'ok'     => false,
				'reason' => 'Décrivez le problème. Un dossier sans description ne se traite pas six mois plus tard.',
			);
		}

		$approved = Bat::last_cleared( $order ) ?? Bat::current( $order );
		$claims   = self::all( $order );

		$claim = array(
			'id'          => count( $claims ) + 1,
			'at'          => gmdate( 'c' ),
			'by'          => function_exists( 'get_current_user_id' ) ? get_current_user_id() : 0,
			'motif'       => $motif,
			'quantity'    => max( 0, $quantity ),
			'description' => mb_substr( $description, 0, self::TEXT_MAX ),
			'stage'       => $order->get_status(),
			'bat'         => null === $approved ? null : array(
				'version'  => (int) $approved['version'],
				'approved' => (string) ( $approved['approval']['at'] ?? '' ),
				'waiver'   => ! empty( $approved['waiver'] ),
			),
			'cause'       => '',
			'decision'    => '',
			'closed_at'   => '',
		);

		$claims[] = $claim;
		$order->update_meta_data( self::META, wp_json_encode( $claims ) );
		$order->save();

		$order->add_order_note(
			sprintf(
				/* translators: 1: the motif, 2: what the customer reported. */
				__( 'Réclamation ouverte (%1$s) : %2$s', 'teeshoop' ),
				self::motifs()[ $motif ],
				$description
			)
		);

		Notify::workshop(
			$order,
			'Réclamation ouverte',
			array(
				sprintf( 'Motif : %s.', self::motifs()[ $motif ] ),
				$description,
			)
		);

		return array(
			'ok'    => true,
			'claim' => $claim,
		);
	}

	/**
	 * Record the cause and what was decided.
	 *
	 * The decision is the human's, in their own words. `verdict()` says what the
	 * matrix would answer and the screen shows it beside the box; it is not
	 * pre-filled, because a default that is usually right is a default that gets
	 * accepted on the day it is wrong.
	 *
	 * @return array{ok:bool,reason:string}
	 */
	public static function close( \WC_Order $order, int $id, string $cause, string $decision ): array {
		$decision = trim( $decision );
		if ( ! isset( self::causes()[ $cause ] ) ) {
			return array(
				'ok'     => false,
				'reason' => 'Choisissez une cause : c’est elle qui décide qui paie.',
			);
		}
		if ( '' === $decision ) {
			return array(
				'ok'     => false,
				'reason' => 'Écrivez ce qui a été décidé. La matrice propose, elle ne décide pas.',
			);
		}

		$claims = self::all( $order );
		foreach ( $claims as $i => $claim ) {
			if ( (int) $claim['id'] !== $id ) {
				continue;
			}
			$claims[ $i ]['cause']     = $cause;
			$claims[ $i ]['decision']  = mb_substr( $decision, 0, self::TEXT_MAX );
			$claims[ $i ]['closed_at'] = gmdate( 'c' );
			$order->update_meta_data( self::META, wp_json_encode( $claims ) );
			$order->save();
			$order->add_order_note(
				sprintf(
					/* translators: 1: the cause, 2: what was decided. */
					__( 'Réclamation tranchée (%1$s) : %2$s', 'teeshoop' ),
					self::causes()[ $cause ],
					$decision
				)
			);
			return array(
				'ok'     => true,
				'reason' => '',
			);
		}

		return array(
			'ok'     => false,
			'reason' => 'Cette réclamation n’existe pas sur cette commande.',
		);
	}

	// ── the screen ───────────────────────────────────────────────────────────

	public static function meta_box(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$screens = array( 'shop_order', 'woocommerce_page_wc-orders' );
		if ( function_exists( 'wc_get_page_screen_id' ) ) {
			$screens[] = wc_get_page_screen_id( 'shop-order' );
		}
		foreach ( array_unique( $screens ) as $screen ) {
			add_meta_box( 'teeshoop-sav', __( 'Réclamations', 'teeshoop' ), array( self::class, 'render_box' ), $screen, 'normal', 'low' );
		}
	}

	/** @param mixed $post_or_order */
	public static function render_box( $post_or_order ): void {
		$order = $post_or_order instanceof \WC_Order ? $post_or_order : wc_get_order( $post_or_order );
		if ( ! $order instanceof \WC_Order ) {
			return;
		}

		/*
		 * THE EVIDENCE FIRST, before any form. The one question this screen
		 * exists to answer is whether we owe a reprint, and half the answer is
		 * whether the customer approved what we pressed.
		 */
		$current = Bat::last_cleared( $order ) ?? Bat::current( $order );
		echo '<p>';
		if ( null === $current ) {
			esc_html_e( 'Aucun bon à tirer sur cette commande : rien n’a été approuvé, donc « erreur validée dans le BAT » ne peut pas s’appliquer.', 'teeshoop' );
		} elseif ( ! empty( $current['approval'] ) ) {
			printf(
				/* translators: 1: a version number, 2: a date and time, 3: an IP address. */
				esc_html__( 'BAT version %1$d validé par le client le %2$s depuis %3$s.', 'teeshoop' ),
				(int) $current['version'],
				esc_html( Lifecycle::human_date( (string) $current['approval']['at'] ) ),
				esc_html( (string) $current['approval']['ip'] )
			);
		} elseif ( ! empty( $current['waiver'] ) ) {
			esc_html_e( 'Le client a renoncé au bon à tirer par écrit : il n’a validé aucun visuel.', 'teeshoop' );
		} else {
			printf(
				/* translators: %d: a version number. */
				esc_html__( 'BAT version %d envoyé, jamais validé.', 'teeshoop' ),
				(int) $current['version']
			);
		}
		echo '</p>';

		foreach ( self::all( $order ) as $claim ) {
			self::render_claim( $order, $claim );
		}

		echo '<hr><form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( self::ACTION_OPEN );
		printf( '<input type="hidden" name="action" value="%s">', esc_attr( self::ACTION_OPEN ) );
		printf( '<input type="hidden" name="order_id" value="%d">', (int) $order->get_id() );
		printf( '<p><label for="ts-sav-motif">%s</label> ', esc_html__( 'Motif', 'teeshoop' ) );
		echo '<select id="ts-sav-motif" name="motif">';
		foreach ( self::motifs() as $key => $label ) {
			printf( '<option value="%s">%s</option>', esc_attr( $key ), esc_html( $label ) );
		}
		echo '</select></p>';
		printf( '<p><label for="ts-sav-qte">%s</label> ', esc_html__( 'Pièces concernées', 'teeshoop' ) );
		echo '<input type="number" id="ts-sav-qte" name="quantite" min="0" step="1" value="0" style="width:6em"></p>';
		printf( '<p><label for="ts-sav-desc">%s</label>', esc_html__( 'Ce que dit le client', 'teeshoop' ) );
		echo '<textarea id="ts-sav-desc" name="description" rows="3" class="large-text"></textarea></p>';
		printf( '<p><button type="submit" class="button">%s</button></p>', esc_html__( 'Ouvrir la réclamation', 'teeshoop' ) );
		echo '</form>';
	}

	private static function render_claim( \WC_Order $order, array $claim ): void {
		$motifs = self::motifs();
		$causes = self::causes();
		$open   = '' === (string) $claim['closed_at'];

		echo '<div style="border:1px solid #dcdcde;padding:.8em;margin:.8em 0">';
		printf(
			'<p style="margin:0 0 .4em"><strong>%s</strong> <span style="color:#646970">%s</span></p>',
			esc_html( $motifs[ $claim['motif'] ] ?? (string) $claim['motif'] ),
			esc_html( Lifecycle::human_date( (string) $claim['at'] ) )
		);
		printf( '<p style="margin:.2em 0">%s</p>', nl2br( esc_html( (string) $claim['description'] ) ) );
		if ( (int) $claim['quantity'] > 0 ) {
			printf(
				'<p style="margin:.2em 0" class="description">%s</p>',
				esc_html( sprintf( /* translators: %d: a number of garments. */ __( '%d pièce(s) concernée(s).', 'teeshoop' ), (int) $claim['quantity'] ) )
			);
		}

		if ( ! $open ) {
			$verdict = self::verdict( (string) $claim['cause'] );
			printf(
				'<p style="margin:.4em 0"><strong>%s</strong> : %s</p><p style="margin:.2em 0">%s</p>',
				esc_html( $causes[ $claim['cause'] ] ?? (string) $claim['cause'] ),
				esc_html( $verdict['solution'] ),
				nl2br( esc_html( (string) $claim['decision'] ) )
			);
			echo '</div>';
			return;
		}

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( self::ACTION_CLOSE );
		printf( '<input type="hidden" name="action" value="%s">', esc_attr( self::ACTION_CLOSE ) );
		printf( '<input type="hidden" name="order_id" value="%d">', (int) $order->get_id() );
		printf( '<input type="hidden" name="id" value="%d">', (int) $claim['id'] );
		printf( '<p><label for="ts-sav-cause-%1$d">%2$s</label> ', (int) $claim['id'], esc_html__( 'Cause', 'teeshoop' ) );
		printf( '<select id="ts-sav-cause-%d" name="cause">', (int) $claim['id'] );
		printf( '<option value="">%s</option>', esc_html__( 'À qualifier', 'teeshoop' ) );
		foreach ( $causes as $key => $label ) {
			$verdict = self::verdict( $key );
			printf(
				'<option value="%s">%s : %s</option>',
				esc_attr( $key ),
				esc_html( $label ),
				esc_html( $verdict['solution'] )
			);
		}
		echo '</select></p>';
		printf( '<p><label for="ts-sav-dec-%1$d">%2$s</label>', (int) $claim['id'], esc_html__( 'Ce qui a été décidé', 'teeshoop' ) );
		printf( '<textarea id="ts-sav-dec-%d" name="decision" rows="2" class="large-text"></textarea></p>', (int) $claim['id'] );
		printf( '<p><button type="submit" class="button">%s</button></p>', esc_html__( 'Clore la réclamation', 'teeshoop' ) );
		echo '</form></div>';
	}

	public static function handle_open(): void {
		$order = self::guard( self::ACTION_OPEN );
		$done  = self::open(
			$order,
			isset( $_POST['motif'] ) ? sanitize_key( wp_unslash( $_POST['motif'] ) ) : '',
			isset( $_POST['description'] ) ? sanitize_textarea_field( wp_unslash( $_POST['description'] ) ) : '',
			isset( $_POST['quantite'] ) ? absint( wp_unslash( $_POST['quantite'] ) ) : 0
		);
		self::back( $order, $done['ok'] ? __( 'Réclamation ouverte.', 'teeshoop' ) : (string) $done['reason'] );
	}

	public static function handle_close(): void {
		$order = self::guard( self::ACTION_CLOSE );
		$done  = self::close(
			$order,
			isset( $_POST['id'] ) ? absint( wp_unslash( $_POST['id'] ) ) : 0,
			isset( $_POST['cause'] ) ? sanitize_key( wp_unslash( $_POST['cause'] ) ) : '',
			isset( $_POST['decision'] ) ? sanitize_textarea_field( wp_unslash( $_POST['decision'] ) ) : ''
		);
		self::back( $order, $done['ok'] ? __( 'Réclamation tranchée.', 'teeshoop' ) : (string) $done['reason'] );
	}

	/** Capability, then nonce, then the order. In that order, every time. */
	private static function guard( string $action ): \WC_Order {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de faire cela.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( $action );
		$order_id = isset( $_POST['order_id'] ) ? absint( wp_unslash( $_POST['order_id'] ) ) : 0;
		$order    = $order_id > 0 ? wc_get_order( $order_id ) : null;
		if ( ! $order instanceof \WC_Order ) {
			wp_die( esc_html__( 'Cette commande n’existe pas.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}
		return $order;
	}

	private static function back( \WC_Order $order, string $message ): void {
		set_transient( 'teeshoop_sav_' . get_current_user_id(), $message, 60 );
		wp_safe_redirect( Lifecycle::order_url( $order->get_id() ) );
		exit;
	}
}
