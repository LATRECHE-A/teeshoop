<?php
/**
 * Le bon à tirer: what the customer approves before anything is pressed.
 *
 * IT IS THE DOCUMENT THAT DECIDES WHO PAYS FOR A REPRINT, and that single
 * sentence settles every design decision in this file. It must show what will
 * actually be pressed, it must be frozen at the moment it is sent, and the
 * approval must be attached to a VERSION rather than to the order, because an
 * approval of version 3 authorises nothing whatsoever about version 4.
 *
 * GENERATED, NEVER ASSEMBLED BY HAND. Every figure on it is read from the order
 * and from the design the Worker confirmed: the garment, the colour, the sizes,
 * the ink area, the transfer rectangles and where each one sits on the garment.
 * A proof somebody retypes is a proof that can disagree with the file, and the
 * disagreement is discovered by a customer opening a parcel.
 *
 * WHAT IT REFUSES TO SAY. A placement that was not measured is printed as not
 * measured (`src/lib/teeshoop/designDoc.ts` drops a placement it cannot trust,
 * and every design uploaded before that field existed has none). A number
 * nobody took, printed in the same type as a number somebody took, is the worst
 * thing this document could contain.
 *
 * THE SIZE THE DIMENSIONS ARE FOR IS PRINTED BESIDE THEM. The whole order is
 * measured once, at the priced size, and the marking is graded with the garment
 * (`src/lib/printScale.ts`): a chest print grows about 23 % from M to 3XL. A
 * proof stating "28,4 x 34,1 cm" with no size beside it contradicts the
 * transfer that gets pressed for every size but one. Question 37.
 *
 * THE LINK NEEDS NO ACCOUNT, because a customer does not have one and question
 * 33 is unanswered. It carries its own capability: 32 random bytes, stored as a
 * SHA-256 digest so a database dump does not let anyone approve anything, minted
 * per version and dead as soon as a newer version exists. `Invoice::serve`'s
 * order key was the obvious token and is the wrong one: that key is already in
 * every WooCommerce e-mail and in the order-received URL, so it authenticates
 * "has seen this order", and approving a proof is a commitment, not a look.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Bat {

	/** Order meta: every version, oldest first, JSON. */
	public const META_VERSIONS = '_teeshoop_bat';

	/** The public page, and the two things it accepts. */
	public const ACTION_VIEW    = 'teeshoop_bat';
	public const ACTION_DECIDE  = 'teeshoop_bat_decision';

	/** The admin actions. */
	public const ACTION_ISSUE  = 'teeshoop_bat_envoyer';
	public const ACTION_WAIVER = 'teeshoop_bat_renonciation';

	/** How long a customer's comment may be. Bounded because the route is open. */
	private const COMMENT_MAX = 4000;

	/**
	 * How many links stay live on one version.
	 *
	 * MORE THAN ONE, AND THAT IS A CORRECTION. A re-send used to mint a token
	 * and drop the previous digest, on the argument that a retry only runs when
	 * the first message did not arrive. That argument is wrong in the one case
	 * that matters: Brevo can accept and deliver a message and still have our
	 * read time out, which is recorded as a failure, and the hourly retry then
	 * killed the link the customer was already holding. So a version keeps its
	 * last few digests and any of them opens it. They all die together the
	 * moment a newer version exists, which is the property that actually
	 * matters.
	 */
	private const LIVE_TOKENS = 3;

	/**
	 * What a writer says when the lock is held.
	 *
	 * ONE STRING, because the page has to tell it apart from every other
	 * refusal: a customer whose approval was not recorded must not be shown the
	 * page that says the proof is settled.
	 */
	public const BUSY_REASON = 'Un autre enregistrement est en cours sur cette commande. Réessayez dans un instant.';

	/**
	 * How long ONE archive copy may spend fetching mockups, seconds.
	 *
	 * Twelve, because a document with eight printed sides would otherwise make
	 * eight independent eight-second requests inside one admin page load.
	 */
	private const FETCH_BUDGET_S = 12.0;

	/** What is left of it, for the render in progress. */
	private static float $fetch_budget = self::FETCH_BUDGET_S;

	/** The named lock every writer of the version list takes. */
	private static function lock_name( \WC_Order $order ): string {
		return 'teeshoop_bat_' . $order->get_id();
	}

	/**
	 * What is assumed about proofs, in one place, because none of it is
	 * answered yet. Question 26 and question 27.
	 *
	 * @return array<string,mixed>
	 */
	public static function default_config(): array {
		return array(
			/*
			 * Included correction rounds, then the price of each further one, in
			 * integer cents HT. Question 26's written default, verbatim: « Deux
			 * corrections incluses puis 15 EUR hors taxes par correction ».
			 *
			 * COUNTED AND SHOWN, NOT CHARGED. Adding a fee to an order that is
			 * already paid is a second payment, a corrective invoice and a
			 * refund path, none of which exists; and the number is a business
			 * decision nobody has taken. So the proof says what a further round
			 * will cost, the order screen says how many are left, and an
			 * operator decides. Question 26 closes it.
			 */
			'corrections_incluses' => 2,
			'correction_ht'        => 1500,

			/*
			 * The tolerances the customer accepts when they approve, question
			 * 27's written default. They are ON THE PROOF because that question
			 * says so in as many words: « Ces tolérances doivent figurer dans
			 * les conditions générales et dans le texte affiché au moment où le
			 * client valide son bon à tirer. » A tolerance nobody was shown is a
			 * tolerance we lose in front of a judge.
			 */
			'tolerance_position_cm' => 1.0,

			/*
			 * How long the approval link stays alive, days.
			 *
			 * NOT A COMMERCIAL PERIOD, so not question 38: that one is the
			 * validity of a devis, which is a firm offer and whose duration is
			 * not displayed anywhere until the associate answers. This is the
			 * life of a capability URL, and it exists because a link that never
			 * expires is a link that gets forwarded, kept in an inbox and
			 * clicked a year later by somebody who is no longer at the company.
			 * Thirty days is long enough that no real customer meets it and
			 * short enough that a stale link is not a standing authorisation;
			 * re-sending the proof mints a new one without making a new version.
			 */
			'lien_jours' => 30,
		);
	}

	/** The config in force. There is no screen for it yet; question 26 brings one. */
	public static function config(): array {
		return self::default_config();
	}

	public static function init(): void {
		add_action( 'admin_post_' . self::ACTION_VIEW, array( self::class, 'serve' ) );
		add_action( 'admin_post_nopriv_' . self::ACTION_VIEW, array( self::class, 'serve' ) );
		add_action( 'admin_post_' . self::ACTION_DECIDE, array( self::class, 'decide' ) );
		add_action( 'admin_post_nopriv_' . self::ACTION_DECIDE, array( self::class, 'decide' ) );

		add_action( 'admin_post_' . self::ACTION_ISSUE, array( self::class, 'handle_issue' ) );
		add_action( 'admin_post_' . self::ACTION_WAIVER, array( self::class, 'handle_waiver' ) );
		add_action( 'add_meta_boxes', array( self::class, 'meta_box' ) );
	}

	// ── reading ──────────────────────────────────────────────────────────────

	/**
	 * Every version of the proof on this order, oldest first.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public static function versions( \WC_Order $order ): array {
		$raw = (string) $order->get_meta( self::META_VERSIONS, true );
		if ( '' === $raw ) {
			return array();
		}
		$rows = json_decode( $raw, true );
		return is_array( $rows ) ? $rows : array();
	}

	/** The newest version, or null when none has ever been sent. */
	public static function current( \WC_Order $order ): ?array {
		$all = self::versions( $order );
		return empty( $all ) ? null : $all[ count( $all ) - 1 ];
	}

	/**
	 * Whether THIS order may be produced, on the proof's evidence alone.
	 *
	 * Reads the approval on the CURRENT version, never the order's status, for
	 * the reason `Ledger` reads receipts and never the status: a shop manager
	 * can pick « BAT validé » from a dropdown with nothing approved.
	 */
	public static function approved( \WC_Order $order ): bool {
		return '' === self::refusal( $order );
	}

	/**
	 * Why production is not authorised, in French, or '' when it is.
	 *
	 * @return string
	 */
	public static function refusal( \WC_Order $order ): string {
		$current = self::current( $order );
		if ( null === $current ) {
			return 'Aucun BAT n’a été envoyé : rien n’a été approuvé, donc rien ne peut être imprimé.';
		}
		/*
		 * A REFUSAL BEATS A WAIVER, whatever order they arrived in. The waiver
		 * used to be read first and returned "nothing blocks this", so a
		 * customer who asked for changes on a version somebody had already
		 * waived was told nothing and the press stayed open. Their word about
		 * their own artwork is the more recent one and the more authoritative.
		 */
		if ( ! empty( $current['changes'] ) ) {
			return sprintf(
				'Le client a demandé des modifications sur le BAT version %d. Rien ne s’imprime tant qu’une nouvelle version n’a pas été validée.',
				(int) $current['version']
			);
		}
		if ( ! empty( $current['waiver'] ) ) {
			return '';
		}
		if ( empty( $current['approval'] ) ) {
			return sprintf(
				'Le BAT version %d n’est pas validé. La production attend la réponse du client, ou une renonciation écrite de sa part.',
				(int) $current['version']
			);
		}
		return '';
	}

	/**
	 * How many correction rounds this order has used, and what is left.
	 *
	 * A ROUND IS A CUSTOMER ASKING, not a version we sent: re-sending the same
	 * proof because the first e-mail bounced is not a correction, and counting
	 * it as one would bill somebody for our own retry.
	 *
	 * @return array{used:int,included:int,left:int,next_ht:int}
	 */
	public static function corrections( \WC_Order $order ): array {
		$used = 0;
		foreach ( self::versions( $order ) as $version ) {
			$used += count( (array) ( $version['changes'] ?? array() ) );
		}
		$config = self::config();
		return array(
			'used'     => $used,
			'included' => (int) $config['corrections_incluses'],
			'left'     => max( 0, (int) $config['corrections_incluses'] - $used ),
			'next_ht'  => (int) $config['correction_ht'],
		);
	}

	// ── composing ────────────────────────────────────────────────────────────

	/**
	 * The proof for this order, as it would be sent today. Side-effect free.
	 *
	 * Composed from the ORDER, never from the Worker: everything the document
	 * needs was frozen onto the line when it was bought (the design id, the
	 * garment, the colour, the measured sides and the size grid), which is what
	 * lets a proof be issued while the Worker is unreachable. The one thing that
	 * still points outward is the preview image, and the page fetches it from
	 * R2 in the customer's own browser.
	 *
	 * @return array{ok:bool,doc?:array,reason?:string}
	 */
	public static function compose( \WC_Order $order ): array {
		$lines = array();

		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$design = (string) $item->get_meta( '_teeshoop_design_id', true );
			if ( '' === $design ) {
				// A plain catalogue line on a mixed order. Nothing is printed on
				// it, so there is nothing to approve.
				continue;
			}

			$garment = (string) $item->get_meta( '_teeshoop_garment', true );
			$sides   = Design::normalise_sides( json_decode( (string) $item->get_meta( '_teeshoop_sides', true ), true ) );
			$grid    = json_decode( (string) $item->get_meta( '_teeshoop_size_grid', true ), true );
			$files   = json_decode( (string) $item->get_meta( '_teeshoop_files', true ), true );

			$lines[] = array(
				'name'      => $item->get_name(),
				'garment'   => $garment,
				'brand_ref' => Garments::has( $garment ) ? Garments::brand_ref( $garment ) : '',
				'colour'    => self::colour_label( (string) $item->get_meta( '_teeshoop_couleur', true ) ),
				'quantity'  => (int) $item->get_quantity(),
				'sizes'     => is_array( $grid ) ? $grid : array(),
				'technique' => self::TECHNIQUE,
				'design_id' => $design,
				'preview'   => self::worker_url( (string) ( $files['preview'] ?? '' ) ),
				'previews'  => self::preview_urls( is_array( $files ) ? (array) ( $files['previews'] ?? array() ) : array() ),
				/*
				 * « Fichier source ou empreinte du fichier » (chapitre 2). The
				 * id IS the fingerprint: it names one immutable set of objects
				 * in R2, and the design document under it is never rewritten.
				 * A hash of the bytes would say the same thing after a round
				 * trip through this server that it has no reason to make.
				 */
				'measured_at' => Garments::has( $garment ) ? Garments::priced_size( $garment ) : '',
				'sides'       => self::describe_sides( $sides ),
				'verified'    => 'yes' === (string) $item->get_meta( '_teeshoop_verified', true ),
			);
		}

		if ( empty( $lines ) ) {
			return array(
				'ok'     => false,
				'reason' => 'Cette commande ne contient aucune ligne personnalisée : il n’y a rien à faire approuver.',
			);
		}

		$config = self::config();

		return array(
			'ok'  => true,
			'doc' => array(
				'order'      => array(
					'number' => $order->get_order_number(),
					'date'   => $order->get_date_created() ? $order->get_date_created()->date( 'Y-m-d' ) : '',
				),
				'customer'   => array(
					'name'    => trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ),
					'company' => $order->get_billing_company(),
					'email'   => $order->get_billing_email(),
				),
				'lines'      => $lines,
				'tolerances' => self::tolerances( $config, self::grades( $lines ) ),
				'text'       => self::acceptance_text(),
			),
		);
	}

	/** The one technique the shop produces today. Question 12. */
	public const TECHNIQUE = 'Impression DTF';

	/**
	 * A side, described the way a press is set up.
	 *
	 * @param array $sides normalised sides off the order line.
	 */
	private static function describe_sides( array $sides ): array {
		$out = array();
		foreach ( $sides as $side ) {
			$pieces = (array) ( $side['pieces'] ?? array() );
			$placed = isset( $side['area_w_cm'], $side['area_h_cm'] ) && ! empty( $pieces );

			$out[] = array(
				'id'         => (string) $side['id'],
				'label'      => Cart::side_label( (string) $side['id'] ),
				'area_sq_cm' => (float) $side['area_sq_cm'],
				'zone_w_cm'  => $placed ? (float) $side['area_w_cm'] : null,
				'zone_h_cm'  => $placed ? (float) $side['area_h_cm'] : null,
				'drop_cm'    => isset( $side['drop_cm'] ) ? (float) $side['drop_cm'] : null,
				'graded'     => isset( $side['graded'] ) ? (bool) $side['graded'] : null,
				'placed'     => $placed,
				'pieces'     => $placed ? array_map(
					static fn( array $p ): array => array(
						'w_cm'         => (float) $p['w_cm'],
						'h_cm'         => (float) $p['h_cm'],
						'top_cm'       => (float) $p['top_cm'],
						'center_dx_cm' => (float) $p['center_dx_cm'],
					),
					$pieces
				) : array(),
			);
		}
		return $out;
	}

	/** A colour id from the studio, as the French name a customer reads. */
	public static function colour_label( string $id ): string {
		if ( '' === $id ) {
			return '';
		}
		foreach ( Garments::colors() as $colour ) {
			if ( (string) ( $colour['id'] ?? '' ) === $id ) {
				return (string) $colour['name'];
			}
		}
		// The catalogue's own colours are not in the studio's list. Showing the
		// raw id beats showing nothing: an operator can read it, and inventing a
		// French name for a code we do not have would be worse than either.
		return $id;
	}

	/**
	 * What the customer accepts by approving. Question 27's written default.
	 *
	 * FROZEN ONTO EVERY VERSION, so a proof approved in March is answered a year
	 * later with the text that was on the screen in March, and not with whatever
	 * this function returns by then.
	 *
	 * @return string[]
	 */
	public static function tolerances( array $config, ?bool $graded = null ): array {
		$out = array(
			sprintf(
				/*
				 * « SUR LA TAILLE INDIQUÉE » IS LOAD-BEARING. The dimensions on
				 * the proof are measured at one size and the marking is graded
				 * with the garment, so a 3XL print sits further below the collar
				 * than the number printed above by much more than a centimetre.
				 * Without those four words the tolerance reads as an absolute
				 * promise this shop cannot keep on any size but one, and the
				 * customer would be right.
				 */
				'Sur la taille indiquée, la position du marquage peut varier de %s par rapport au bon à tirer.',
				Garments::cm( (float) $config['tolerance_position_cm'] )
			),
			'Les couleurs d’un écran ne sont pas celles d’un textile imprimé : un écart de teinte est normal et n’est pas un défaut.',
			'Une erreur de taille choisie par vos soins ne donne pas lieu à reprise : un vêtement personnalisé ne peut pas être remis en vente.',
		);

		/*
		 * THE GRADING SENTENCE DEPENDS ON THE DESIGN, and it used to be printed
		 * unconditionally. The studio offers a two-button choice: `scaled`, where
		 * the marking grows with the garment, and `fixed`, where one identical
		 * transfer is pressed on every size, which is the cheaper option and a
		 * real convention. Telling a `fixed` customer their marking scales is
		 * promising something that will not be pressed. Null is a document
		 * written before the flag existed, and it says nothing rather than
		 * guessing which answer is commoner.
		 */
		if ( true === $graded ) {
			array_splice( $out, 2, 0, array( 'Les dimensions indiquées sont mesurées sur la taille de référence et sont mises à l’échelle avec le vêtement : un marquage est plus grand sur un 3XL que sur un S.' ) );
		} elseif ( false === $graded ) {
			array_splice( $out, 2, 0, array( 'Le même marquage, aux mêmes dimensions, est pressé sur toutes les tailles commandées.' ) );
		}

		return $out;
	}

	/**
	 * Whether the marking grades, across every line of this proof.
	 *
	 * Null when nothing says. FALSE only when every side that says anything says
	 * no: a document mixing the two is not one this shop can describe in one
	 * sentence, so it says nothing rather than picking a side.
	 */
	private static function grades( array $lines ): ?bool {
		$seen = array();
		foreach ( $lines as $line ) {
			foreach ( (array) $line['sides'] as $side ) {
				if ( null !== $side['graded'] ) {
					$seen[] = (bool) $side['graded'];
				}
			}
		}
		if ( empty( $seen ) ) {
			return null;
		}
		$unique = array_unique( $seen );
		return 1 === count( $unique ) ? (bool) $unique[ array_key_first( $unique ) ] : null;
	}

	/**
	 * The sentence beside the approve button, frozen onto the version.
	 *
	 * IT IS AN ACT, NOT A CLICK. It says what starts, what stops being possible
	 * and what is being recorded, because that is what makes an approval worth
	 * having in a dispute. Question 18 asks the associate's lawyer to review the
	 * wording; the mechanism does not wait for that, and neither does the record.
	 */
	public static function acceptance_text(): string {
		return 'En validant ce bon à tirer, je confirme que le visuel, les dimensions, '
			. 'l’emplacement, les couleurs, les tailles et les quantités correspondent à ma '
			. 'commande. Je sais que la production démarre immédiatement, que ces articles '
			. 'sont personnalisés à ma demande et qu’ils ne peuvent plus être modifiés, '
			. 'annulés ni repris. La date, l’heure et l’adresse IP de cette validation sont '
			. 'enregistrées.';
	}

	// ── issuing ──────────────────────────────────────────────────────────────

	/**
	 * Freeze a new version and mint the link that opens it.
	 *
	 * FROZEN, like an invoice and for the same reason. What was on the screen
	 * when the customer pressed the button is the only thing that answers a
	 * dispute, and re-rendering from the live order a year later answers a
	 * different question: it says what the order is now, not what was approved.
	 *
	 * RETURNS THE RAW TOKEN AND STORES ONLY ITS DIGEST. The caller sends it and
	 * then it is gone: nothing in the database, in a backup or in the mail log
	 * can be turned back into a link that approves anything. The cost is that a
	 * lost e-mail is re-sent rather than re-read, which `resend()` does by
	 * minting a new token against the same version.
	 *
	 * @param string $note operator remarks printed on the proof, may be empty.
	 *
	 * @return array{ok:bool,version?:array,token?:string,reason?:string}
	 */
	public static function issue( \WC_Order $order, string $note = '' ): array {
		$composed = self::compose( $order );
		if ( empty( $composed['ok'] ) ) {
			return array(
				'ok'     => false,
				'reason' => (string) $composed['reason'],
			);
		}

		$config = self::config();
		$token  = self::mint();

		/*
		 * THE LOCK, AND WHAT IT COSTS NOT TO HAVE ONE. Every writer here does a
		 * read-modify-write on one JSON list in order meta. Two of them at once
		 * and the loser vanishes: an operator issuing version 2 while the
		 * customer approves version 1 could leave the order approved on v1 with
		 * v2 gone, so the workshop presses the artwork the operator had just
		 * replaced. `Invoice::issue` has taken this lock since session 04 for
		 * exactly the same shape of write.
		 */
		if ( ! Invoice::lock( self::lock_name( $order ) ) ) {
			return array(
				'ok'     => false,
				'reason' => self::BUSY_REASON,
			);
		}
		// Re-read INSIDE the lock: the object we were handed may have been read
		// before the other writer committed.
		$order    = wc_get_order( $order->get_id() ) ?: $order;
		$versions = self::versions( $order );

		$version = array_merge(
			$composed['doc'],
			array(
				'version'     => count( $versions ) + 1,
				'issued_at'   => gmdate( 'c' ),
				'issued_by'   => function_exists( 'get_current_user_id' ) ? get_current_user_id() : 0,
				'note'        => mb_substr( trim( $note ), 0, 1000 ),
				'tokens'      => array( hash( 'sha256', $token ) ),
				'expires_at'  => gmdate( 'c', time() + (int) $config['lien_jours'] * DAY_IN_SECONDS ),
				'approval'    => null,
				'waiver'      => null,
				'changes'     => array(),
			)
		);

		$versions[] = $version;
		$order->update_meta_data( self::META_VERSIONS, wp_json_encode( $versions ) );
		$order->save();
		Invoice::unlock( self::lock_name( $order ) );

		/*
		 * THE STATUS FOLLOWS THE DOCUMENT, and it is allowed to fail without
		 * losing the version. An order that cannot legally reach « BAT envoyé »
		 * (one that is not paid, say) still gets its proof frozen, and the
		 * operator is told why the label did not move. Losing the frozen version
		 * because a label refused would be the wrong way round.
		 */
		$moved = Lifecycle::transition(
			$order,
			Lifecycle::PROOF,
			array(
				'source' => 'bat',
				'reason' => sprintf( 'BAT version %d envoyé', (int) $version['version'] ),
			)
		);

		return array(
			'ok'      => true,
			'version' => $version,
			'token'   => $token,
			'status'  => $moved,
		);
	}

	/**
	 * A new link on the SAME version, for a proof whose e-mail never arrived.
	 *
	 * Re-sending is not a correction: it makes no version, counts against no
	 * included round, and the customer is being shown exactly what they were
	 * shown before. It does kill the previous link, which is deliberate. One
	 * live capability per version is a property worth keeping, and this path
	 * only runs when the previous e-mail failed, so nobody is holding the old
	 * one.
	 *
	 * @return array{ok:bool,version?:array,token?:string,reason?:string}
	 */
	public static function resend( \WC_Order $order ): array {
		if ( ! Invoice::lock( self::lock_name( $order ) ) ) {
			return array(
				'ok'     => false,
				'reason' => self::BUSY_REASON,
			);
		}
		$order    = wc_get_order( $order->get_id() ) ?: $order;
		$versions = self::versions( $order );
		if ( empty( $versions ) ) {
			Invoice::unlock( self::lock_name( $order ) );
			return array(
				'ok'     => false,
				'reason' => 'Aucun BAT n’a encore été établi sur cette commande.',
			);
		}
		$last = count( $versions ) - 1;

		/*
		 * A VERSION THAT HAS BEEN ANSWERED IS NOT RE-SENDABLE, whichever way it
		 * was answered. Approved, refused, or covered by a written waiver: in
		 * all three cases the file has moved on, and an hourly retry of a failed
		 * e-mail would otherwise mail a customer a live link inviting them to
		 * approve something the workshop is already pressing. Checking only the
		 * approval left the other two open.
		 */
		if ( ! empty( $versions[ $last ]['approval'] ) || ! empty( $versions[ $last ]['waiver'] ) || ! empty( $versions[ $last ]['changes'] ) ) {
			Invoice::unlock( self::lock_name( $order ) );
			return array(
				'ok'     => false,
				'reason' => 'Ce BAT a déjà reçu une réponse : il n’y a plus rien à approuver.',
			);
		}

		$token  = self::mint();
		$config = self::config();
		// APPENDED, never replaced. See LIVE_TOKENS.
		$tokens   = self::digests( $versions[ $last ] );
		$tokens[] = hash( 'sha256', $token );
		$versions[ $last ]['tokens']     = array_slice( $tokens, -self::LIVE_TOKENS );
		$versions[ $last ]['expires_at'] = gmdate( 'c', time() + (int) $config['lien_jours'] * DAY_IN_SECONDS );

		$order->update_meta_data( self::META_VERSIONS, wp_json_encode( $versions ) );
		$order->save();
		Invoice::unlock( self::lock_name( $order ) );

		return array(
			'ok'      => true,
			'version' => $versions[ $last ],
			'token'   => $token,
		);
	}

	/**
	 * The digests that open one version.
	 *
	 * Reads `tokens` and falls back to the single `token` a version frozen
	 * before this existed carries. Dropping that fallback would 404 every proof
	 * already sent, which is a customer holding a link we told them to use.
	 *
	 * @return string[]
	 */
	private static function digests( array $version ): array {
		$list = (array) ( $version['tokens'] ?? array() );
		if ( empty( $list ) && ! empty( $version['token'] ) ) {
			$list = array( (string) $version['token'] );
		}
		return array_values( array_filter( array_map( 'strval', $list ) ) );
	}

	/**
	 * 32 random bytes, URL-safe.
	 *
	 * `random_bytes` and nothing else: it throws when the platform cannot give
	 * real randomness, which is the correct behaviour for a value whose only job
	 * is being unguessable. A fallback to `mt_rand` would turn a hard failure
	 * into a link somebody can predict.
	 */
	private static function mint(): string {
		return rtrim( strtr( base64_encode( random_bytes( 32 ) ), '+/', '-_' ), '=' );
	}

	/** The link that opens one version of the proof. */
	public static function url( \WC_Order $order, int $version, string $token ): string {
		return add_query_arg(
			array(
				'action' => self::ACTION_VIEW,
				'c'      => $order->get_id(),
				'v'      => $version,
				'j'      => $token,
			),
			admin_url( 'admin-post.php' )
		);
	}

	/**
	 * The per-side mockups, as addresses a browser can reach.
	 *
	 * Re-checked here and not only where they were stored: an order written
	 * before `Design::normalise_previews` existed carries whatever the manifest
	 * said, and these strings go into an `img src` on a page a customer opens.
	 *
	 * @return array<string,string>
	 */
	private static function preview_urls( array $paths ): array {
		$out = array();
		foreach ( Design::normalise_previews( $paths ) as $side => $path ) {
			$url = self::worker_url( $path );
			if ( '' !== $url ) {
				$out[ $side ] = $url;
			}
		}
		return $out;
	}

	/** A path out of the design manifest, as an address a browser can reach. */
	public static function worker_url( string $path ): string {
		$base = Settings::get( 'worker_url' );
		if ( '' === $base || '' === $path ) {
			return '';
		}
		return rtrim( $base, '/' ) . '/' . ltrim( $path, '/' );
	}

	// ── the customer's side ──────────────────────────────────────────────────

	/**
	 * Find the version a request is asking about, and say whether it may act.
	 *
	 * ONE FUNCTION FOR BOTH THE PAGE AND THE DECISION, because the two must
	 * never disagree about who is allowed: a page that renders an approve button
	 * the POST handler then refuses is a customer told their approval did not
	 * count, and a POST handler laxer than the page is the actual hole.
	 *
	 * @return array{order:?\WC_Order,version:?array,state:string}
	 *         state: ok | not_found | expired | superseded | decided
	 */
	public static function locate( int $order_id, int $version_no, string $token ): array {
		$none = array(
			'order'   => null,
			'version' => null,
			'state'   => 'not_found',
		);

		if ( $order_id <= 0 || $version_no <= 0 || strlen( $token ) < 20 ) {
			return $none;
		}
		$order = wc_get_order( $order_id );
		if ( ! $order instanceof \WC_Order ) {
			return $none;
		}

		$versions = self::versions( $order );
		$found    = null;
		foreach ( $versions as $candidate ) {
			if ( (int) ( $candidate['version'] ?? 0 ) === $version_no ) {
				$found = $candidate;
				break;
			}
		}
		if ( null === $found ) {
			return $none;
		}

		/*
		 * CONSTANT TIME, and the comparison is against the DIGEST. Anything else
		 * on this route leaks by timing, and storing the token itself would make
		 * a database backup a set of live approvals.
		 *
		 * Every live digest is compared and the loop is NOT short-circuited, so
		 * the work is the same whichever one matches and whether any does.
		 */
		$offered = hash( 'sha256', $token );
		$match   = false;
		foreach ( self::digests( $found ) as $digest ) {
			$match = hash_equals( $digest, $offered ) || $match;
		}
		if ( ! $match ) {
			// The same answer as a missing order, deliberately: a different one
			// would confirm that this order number exists.
			return $none;
		}

		$state = 'ok';
		if ( ! empty( $found['approval'] ) || ! empty( $found['changes'] ) ) {
			$state = 'decided';
		} elseif ( $version_no !== count( $versions ) ) {
			$state = 'superseded';
		} elseif ( strtotime( (string) $found['expires_at'] ) < time() ) {
			$state = 'expired';
		}

		return array(
			'order'   => $order,
			'version' => $found,
			'state'   => $state,
		);
	}

	/**
	 * Render the proof to whoever holds the link, or the archive copy.
	 *
	 * TWO WAYS IN AND THEY ARE NOT THE SAME. The token is the customer's: it
	 * names one version, dies when a newer one exists, and is the only thing
	 * that authorises a decision. A shop manager gets in without it, because
	 * they can already read the order, and `Invoice::serve` makes exactly this
	 * split for exactly this reason. What a shop manager can NOT do here is
	 * decide: `decide()` takes the token and nothing else, so an approval is
	 * always the customer's own act.
	 */
	public static function serve(): void {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- the token IS the capability, checked in locate(); the operator path is a capability check.
		$order_id = isset( $_GET['c'] ) ? absint( wp_unslash( $_GET['c'] ) ) : 0;
		$number   = isset( $_GET['v'] ) ? absint( wp_unslash( $_GET['v'] ) ) : 0;
		$token    = isset( $_GET['j'] ) ? sanitize_text_field( wp_unslash( $_GET['j'] ) ) : '';
		$as_pdf   = ! empty( $_GET['pdf'] );
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		$found = self::locate( $order_id, $number, $token );
		if ( null === $found['order'] && current_user_can( 'edit_shop_orders' ) ) {
			$found = self::locate_as_operator( $order_id, $number );
		}

		nocache_headers();
		// An approval page must never be indexed, cached by a proxy, or framed.
		header( 'X-Robots-Tag: noindex, nofollow, noarchive' );
		header( 'Referrer-Policy: no-referrer' );
		header( 'X-Frame-Options: DENY' );

		if ( null === $found['order'] ) {
			header( 'Content-Type: text/html; charset=utf-8' );
			status_header( 404 );
			BatPage::not_found();
			exit;
		}

		if ( $as_pdf ) {
			$pdf = self::pdf( $found['version'] );
			header( 'Content-Type: application/pdf' );
			header( 'Content-Length: ' . strlen( $pdf ) );
			header(
				'Content-Disposition: attachment; filename="' . sanitize_file_name(
					sprintf( 'BAT-%s-v%d', (string) ( $found['version']['order']['number'] ?? $order_id ), (int) $found['version']['version'] )
				) . '.pdf"'
			);
			echo $pdf; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- binary PDF.
			exit;
		}

		header( 'Content-Type: text/html; charset=utf-8' );
		BatPage::render( $found['order'], $found['version'], $found['state'], $token );
		exit;
	}

	/**
	 * The same lookup for somebody who can already read the order.
	 *
	 * Reports its own state, and the page draws no buttons for it. An operator
	 * opening a proof must not be handed a form that would record THEM as the
	 * customer, and reusing the customer's `decided` state to get there would
	 * make the page claim a decision that has not been taken.
	 *
	 * @return array{order:?\WC_Order,version:?array,state:string}
	 */
	private static function locate_as_operator( int $order_id, int $version_no ): array {
		$none = array(
			'order'   => null,
			'version' => null,
			'state'   => 'not_found',
		);
		$order = $order_id > 0 ? wc_get_order( $order_id ) : null;
		if ( ! $order instanceof \WC_Order ) {
			return $none;
		}
		foreach ( self::versions( $order ) as $candidate ) {
			if ( (int) ( $candidate['version'] ?? 0 ) === $version_no ) {
				return array(
					'order'   => $order,
					'version' => $candidate,
					'state'   => 'operateur',
				);
			}
		}
		return $none;
	}

	/**
	 * Approve, or ask for changes: the REQUEST half.
	 *
	 * It reads the request, calls `record_decision()` and renders. Nothing is
	 * decided here, deliberately: a handler that reads `$_POST` and ends in
	 * `exit` cannot be called from a test, so a suite driving it would have to
	 * restate the rules, and a test that restates the rules proves that the
	 * restatement works.
	 */
	public static function decide(): void {
		$order_id = isset( $_POST['c'] ) ? absint( wp_unslash( $_POST['c'] ) ) : 0;
		$version  = isset( $_POST['v'] ) ? absint( wp_unslash( $_POST['v'] ) ) : 0;
		$token    = isset( $_POST['j'] ) ? sanitize_text_field( wp_unslash( $_POST['j'] ) ) : '';
		$choice   = isset( $_POST['choix'] ) ? sanitize_key( wp_unslash( $_POST['choix'] ) ) : '';
		$comment  = isset( $_POST['commentaire'] ) ? sanitize_textarea_field( wp_unslash( $_POST['commentaire'] ) ) : '';

		$found = self::locate( $order_id, $version, $token );

		nocache_headers();
		header( 'X-Robots-Tag: noindex, nofollow, noarchive' );
		header( 'Referrer-Policy: no-referrer' );
		header( 'X-Frame-Options: DENY' );
		header( 'Content-Type: text/html; charset=utf-8' );

		if ( null === $found['order'] ) {
			status_header( 404 );
			BatPage::not_found();
			exit;
		}
		if ( 'ok' !== $found['state'] ) {
			// The page that says why: expired, replaced, or already answered.
			status_header( 409 );
			BatPage::render( $found['order'], $found['version'], $found['state'], $token );
			exit;
		}

		/*
		 * REMOTE_ADDR AND NOT X-Forwarded-For. A forwarded header is written by
		 * whoever sent the request, so recording it would let the person
		 * approving choose what the evidence says. WordPress is served directly
		 * on this host; the day it sits behind a proxy, that proxy's own trusted
		 * header is configured once, here, on purpose.
		 */
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? mb_substr( sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ), 0, 300 ) : '';

		$decided = self::record_decision( $found['order'], $version, $choice, $comment, $ip, $ua );
		if ( empty( $decided['ok'] ) ) {
			/*
			 * TWO REFUSALS THAT MUST NOT LOOK ALIKE. "Already answered" is a
			 * settled document and the page says so. A lock that timed out is
			 * a customer whose approval was NOT recorded, and rendering the
			 * settled page for it would tell them their click had counted while
			 * the order sat unapproved: the workshop waits, the customer waits,
			 * and neither knows. Two seconds of `GET_LOCK` is enough for this to
			 * happen exactly when an operator is issuing a new version.
			 */
			status_header( 409 );
			BatPage::render(
				$found['order'],
				$found['version'],
				self::BUSY_REASON === (string) $decided['reason'] ? 'busy' : 'decided',
				$token
			);
			exit;
		}

		BatPage::render( wc_get_order( $order_id ), $decided['version'], 'decided', $token );
		exit;
	}

	/**
	 * Write the customer's decision onto the version. THE DECISION ITSELF.
	 *
	 * WHAT IS RECORDED AND WHY EACH PART. The instant, because « quand » is the
	 * first question anyone asks. The address, because it is the only thing
	 * distinguishing the customer's own click from ours. The exact version and
	 * the exact wording that was on the screen, because a document that has
	 * moved since cannot tell you what was agreed to. The user agent, because a
	 * dispute about "I never clicked that" is answered by the whole record or
	 * not at all.
	 *
	 * @param string $choice `valider`, or anything else, which asks for changes.
	 *
	 * @return array{ok:bool,version?:array,reason?:string}
	 */
	public static function record_decision( \WC_Order $order, int $version, string $choice, string $comment, string $ip, string $ua ): array {
		if ( ! Invoice::lock( self::lock_name( $order ) ) ) {
			return array(
				'ok'     => false,
				'reason' => self::BUSY_REASON,
			);
		}
		// Re-read inside the lock, so a decision cannot be written over a
		// version issued between the page load and the click.
		$order    = wc_get_order( $order->get_id() ) ?: $order;
		$versions = self::versions( $order );
		$index    = null;
		foreach ( $versions as $i => $candidate ) {
			if ( (int) ( $candidate['version'] ?? 0 ) === $version ) {
				$index = $i;
				break;
			}
		}
		if ( null === $index ) {
			Invoice::unlock( self::lock_name( $order ) );
			return array(
				'ok'     => false,
				'reason' => 'Cette version du bon à tirer n’existe pas.',
			);
		}
		if ( ! empty( $versions[ $index ]['approval'] ) || ! empty( $versions[ $index ]['changes'] ) || ! empty( $versions[ $index ]['waiver'] ) ) {
			// ANSWERED ONCE. A second decision on the same version would either
			// overwrite an approval or count a correction round twice, and both
			// are worse than telling the customer it is already done. This is
			// also what a double click resolves to, now that the read and the
			// write are inside one lock.
			Invoice::unlock( self::lock_name( $order ) );
			return array(
				'ok'     => false,
				'reason' => 'Ce bon à tirer a déjà reçu une réponse.',
			);
		}

		$now = gmdate( 'c' );

		if ( 'valider' === $choice ) {
			$versions[ $index ]['approval'] = array(
				'at'   => $now,
				'ip'   => $ip,
				'ua'   => $ua,
				'text' => (string) $versions[ $index ]['text'],
				'by'   => 'client',
			);
		} else {
			/*
			 * THE COMMENT IS THE POINT OF THIS BRANCH. A refusal that loses what
			 * the customer asked for turns one correction round into two, and
			 * the second one is our own fault. It is stored on the version that
			 * was refused, so the next version is composed beside it.
			 */
			$versions[ $index ]['changes'][] = array(
				'at'      => $now,
				'ip'      => $ip,
				'comment' => mb_substr( $comment, 0, self::COMMENT_MAX ),
			);
		}

		$order->update_meta_data( self::META_VERSIONS, wp_json_encode( $versions ) );
		$order->save();
		Invoice::unlock( self::lock_name( $order ) );

		$approved = 'valider' === $choice;
		Lifecycle::transition(
			$order,
			$approved ? Lifecycle::APPROVED : Lifecycle::CHANGES,
			array(
				'source' => 'client',
				'reason' => $approved
					? sprintf( 'BAT version %d validé par le client', $version )
					: sprintf( 'Modifications demandées sur le BAT version %d', $version ),
			)
		);

		do_action(
			$approved ? 'teeshoop_bat_approved' : 'teeshoop_bat_changes',
			wc_get_order( $order->get_id() ),
			$versions[ $index ]
		);

		return array(
			'ok'      => true,
			'version' => $versions[ $index ],
		);
	}

	// ── the archive copy ─────────────────────────────────────────────────────

	/**
	 * The proof as a PDF, rendered from the FROZEN version.
	 *
	 * « Une copie PDF doit être archivée » (chapitre 2). Archived means
	 * reproducible from the record, not stored as a blob: a 900 px mockup per
	 * side would put megabytes into order meta, and the record plus this
	 * function say the same thing without them. It is the same choice
	 * `Invoice::pdf` makes, and for the same reason.
	 *
	 * @param bool $with_images fetch the mockups. False renders in one pass with
	 *                          no network, which is what a test wants.
	 */
	public static function pdf( array $version, bool $with_images = true ): string {
		self::$fetch_budget = self::FETCH_BUDGET_S;
		$pdf  = new Pdf();
		$left = 18.0;
		$right = 192.0;
		$y    = 22.0;

		$pdf->text( $left, $y, 'BON À TIRER', Pdf::BOLD, 18 );
		$y += 8;
		$pdf->text(
			$left,
			$y,
			sprintf(
				'Commande %s, version %d, établie le %s',
				(string) ( $version['order']['number'] ?? '' ),
				(int) $version['version'],
				self::pdf_date( (string) $version['issued_at'] )
			),
			Pdf::REGULAR,
			10,
			0.25
		);
		$y += 5;
		$who = trim( (string) ( $version['customer']['company'] ?? '' ) );
		if ( '' === $who ) {
			$who = trim( (string) ( $version['customer']['name'] ?? '' ) );
		}
		if ( '' !== $who ) {
			$pdf->text( $left, $y, $who, Pdf::REGULAR, 10, 0.25 );
			$y += 5;
		}
		$pdf->rule( $left, $y, $right, 0.4, 0.2 );
		$y += 7;

		if ( ! empty( $version['approval'] ) ) {
			$pdf->text(
				$left,
				$y,
				sprintf( 'Validé par le client le %s, depuis %s', self::pdf_date( (string) $version['approval']['at'] ), (string) $version['approval']['ip'] ),
				Pdf::BOLD,
				10
			);
			$y += 7;
		} elseif ( ! empty( $version['waiver'] ) ) {
			$pdf->text( $left, $y, 'Production lancée sur renonciation écrite du client au bon à tirer', Pdf::BOLD, 10 );
			$y += 7;
		}

		foreach ( (array) $version['lines'] as $line ) {
			if ( $y > 235 ) {
				$pdf->page_break();
				$y = 22.0;
			}
			$pdf->text( $left, $y, (string) $line['name'], Pdf::BOLD, 12 );
			$y += 6;
			$facts = array_filter(
				array(
					'Couleur : ' . (string) $line['colour'],
					'' !== (string) $line['brand_ref'] ? 'Référence : ' . (string) $line['brand_ref'] : '',
					'Technique : ' . (string) $line['technique'],
					'Quantité : ' . (int) $line['quantity'],
				)
			);
			$pdf->text( $left, $y, implode( '   ', $facts ), Pdf::REGULAR, 9.5 );
			$y += 5;

			$sizes = (array) ( $line['sizes'] ?? array() );
			if ( ! empty( $sizes ) ) {
				$parts = array();
				foreach ( $sizes as $size => $count ) {
					$parts[] = (int) $count . ' × ' . strtoupper( (string) $size );
				}
				$pdf->text( $left, $y, 'Tailles : ' . implode( ' · ', $parts ), Pdf::REGULAR, 9.5 );
				$y += 6;
			}

			foreach ( (array) $line['sides'] as $side ) {
				$y = self::pdf_side( $pdf, $line, $side, $left, $right, $y, $with_images );
			}
			$y += 3;
		}

		if ( $y > 210 ) {
			$pdf->page_break();
			$y = 22.0;
		}
		$pdf->rule( $left, $y, $right, 0.2, 0.6 );
		$y += 6;
		$pdf->text( $left, $y, 'Ce que le client accepte en validant', Pdf::BOLD, 10 );
		$y += 5;
		foreach ( (array) ( $version['tolerances'] ?? array() ) as $item ) {
			foreach ( Pdf::wrap( (string) $item, $right - $left - 4, Pdf::REGULAR, 8.5 ) as $row ) {
				$pdf->text( $left + 4, $y, $row, Pdf::REGULAR, 8.5, 0.2 );
				$y += 4;
			}
			$y += 1;
		}
		$y += 3;
		foreach ( Pdf::wrap( (string) $version['text'], $right - $left, Pdf::REGULAR, 8.5 ) as $row ) {
			$pdf->text( $left, $y, $row, Pdf::REGULAR, 8.5, 0.2 );
			$y += 4;
		}

		return $pdf->render(
			sprintf( 'BAT %s v%d', (string) ( $version['order']['number'] ?? '' ), (int) $version['version'] ),
			'D:' . gmdate( 'YmdHis' ) . "+00'00'"
		);
	}

	/** One printed face on the archive copy: the mockup, then the numbers. */
	private static function pdf_side( Pdf $pdf, array $line, array $side, float $left, float $right, float $y, bool $with_images ): float {
		if ( $y > 215 ) {
			$pdf->page_break();
			$y = 22.0;
		}
		$pdf->text( $left, $y, (string) $side['label'], Pdf::BOLD, 10 );
		$y += 5;

		$top = $y;
		$col = $left;
		if ( $with_images ) {
			$shot = (string) ( ( (array) ( $line['previews'] ?? array() ) )[ $side['id'] ] ?? '' );
			if ( '' === $shot && 'front' === $side['id'] ) {
				$shot = (string) ( $line['preview'] ?? '' );
			}
			$jpeg = '' === $shot ? '' : self::jpeg_of( $shot );
			if ( '' !== $jpeg && $pdf->image( $jpeg, $left, $y, 55, 55 ) ) {
				$col = $left + 60;
			} else {
				/*
				 * SAYING SO, in the document, rather than leaving a gap. A proof
				 * whose artwork is missing is not a proof, and an archive copy
				 * that does not admit the artwork is missing would be read years
				 * later as though it had shown one.
				 */
				$pdf->text( $left, $y + 4, 'Aperçu non disponible sur cette copie.', Pdf::REGULAR, 8.5, 0.4 );
				$col = $left;
				$y  += 8;
			}
		}

		$rows = array( 'Surface imprimée : ' . Money::number( (float) $side['area_sq_cm'], 0 ) . ' cm²' );
		if ( ! empty( $side['placed'] ) ) {
			$rows[] = 'Zone : ' . Garments::cm( (float) $side['zone_w_cm'] ) . ' × ' . Garments::cm( (float) $side['zone_h_cm'] );
			if ( null !== $side['drop_cm'] ) {
				$rows[] = 'Centre de zone sous l’encolure : ' . Garments::cm( (float) $side['drop_cm'] );
			}
			$n = 1;
			foreach ( (array) $side['pieces'] as $piece ) {
				$rows[] = sprintf(
					'Visuel %d : %s × %s, à %s du haut de zone, %s',
					$n,
					Garments::cm( (float) $piece['w_cm'] ),
					Garments::cm( (float) $piece['h_cm'] ),
					Garments::cm( (float) $piece['top_cm'] ),
					self::pdf_offset( (float) $piece['center_dx_cm'] )
				);
				++$n;
			}
		} else {
			$rows[] = 'Placement non mesuré : à confirmer avec le client avant impression.';
		}
		if ( ! empty( $line['measured_at'] ) ) {
			// The archive copy says the same thing the page said, including
			// saying nothing when the document predates the grading flag.
			$grading = true === $side['graded']
				? ', mises à l’échelle avec le vêtement'
				: ( false === $side['graded'] ? ', identiques sur toutes les tailles' : '' );
			$rows[]  = 'Dimensions données pour la taille ' . strtoupper( (string) $line['measured_at'] ) . $grading . '.';
		}

		$ty = $top + 4;
		foreach ( $rows as $row ) {
			foreach ( Pdf::wrap( $row, $right - $col, Pdf::REGULAR, 9, ) as $wrapped ) {
				$pdf->text( $col, $ty, $wrapped, Pdf::REGULAR, 9 );
				$ty += 4.4;
			}
		}

		return max( $ty, $with_images && $col > $left ? $top + 58 : $ty ) + 3;
	}

	/** "centré", or a distance and a direction. On a proof the direction is half the number. */
	private static function pdf_offset( float $value ): string {
		if ( abs( $value ) < 0.05 ) {
			return 'centré sur l’axe';
		}
		return Garments::cm( abs( $value ) ) . ( $value > 0 ? ' vers la droite' : ' vers la gauche' );
	}

	/** An ISO instant, as a Paris date on a printed document. */
	private static function pdf_date( string $iso ): string {
		$ts = strtotime( $iso );
		if ( ! $ts ) {
			return $iso;
		}
		return function_exists( 'wp_date' ) ? (string) wp_date( 'd/m/Y à H:i', $ts ) : gmdate( 'd/m/Y H:i', $ts );
	}

	/**
	 * A stored mockup, as JPEG bytes the PDF writer will take.
	 *
	 * The preview is a PNG and `Pdf` embeds only baseline JPEG, for the reasons
	 * its own header gives. Converting needs GD, which is on the container and
	 * on o2switch (checked), and the whole path fails to an empty string rather
	 * than to an exception: an archive copy without its image says so on the
	 * page, and refusing to render the document at all because a mockup could
	 * not be fetched would be a worse answer to give an operator.
	 */
	private static function jpeg_of( string $url ): string {
		if ( ! function_exists( 'imagecreatefromstring' ) || ! function_exists( 'imagejpeg' ) ) {
			return '';
		}
		/*
		 * A BUDGET FOR THE WHOLE DOCUMENT, not a timeout per fetch. A four-line
		 * order printed front and back is eight sequential fetches, and eight
		 * times eight seconds is a minute of an admin request holding a php-fpm
		 * worker before anything renders. The budget is spent once per render
		 * and the sides that do not fit in it print the same "aperçu non
		 * disponible" line an unreachable one does, which the page already says.
		 */
		if ( self::$fetch_budget <= 0 ) {
			return '';
		}
		$started = microtime( true );

		$response = wp_remote_get(
			$url,
			array(
				'timeout'     => min( 8, max( 1, (int) ceil( self::$fetch_budget ) ) ),
				'redirection' => 0,
			)
		);
		self::$fetch_budget -= microtime( true ) - $started;
		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			return '';
		}
		$png = (string) wp_remote_retrieve_body( $response );
		/*
		 * AND A BOUND ON WHAT IS DECODED. `imagecreatefromstring` allocates
		 * width x height x 4 bytes whatever the compressed size, so a crafted or
		 * simply enormous PNG is a memory limit hit in the middle of rendering a
		 * document. The mockups this shop writes are 900 px wide; twelve
		 * megabytes is the Worker's own per-file cap and far above any of them.
		 */
		if ( strlen( $png ) > 12 * 1024 * 1024 ) {
			return '';
		}
		// Magic bytes, never the content-type header: what a response calls
		// itself is a claim by whoever sent it, and this goes into a document.
		if ( "\x89PNG\r\n\x1a\n" !== substr( $png, 0, 8 ) ) {
			return '';
		}

		$image = @imagecreatefromstring( $png ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- a corrupt PNG must produce no image, not a warning in the output.
		if ( ! $image ) {
			return '';
		}
		/*
		 * FLATTENED ONTO WHITE. JPEG has no alpha, and a mockup with a
		 * transparent background written straight to JPEG comes out on black:
		 * a customer's white shirt would print as a black one on the archive
		 * copy of the very document that settles a colour dispute.
		 */
		$w    = imagesx( $image );
		$h    = imagesy( $image );
		$flat = imagecreatetruecolor( $w, $h );
		imagefill( $flat, 0, 0, imagecolorallocate( $flat, 255, 255, 255 ) );
		imagecopy( $flat, $image, 0, 0, 0, 0, $w, $h );
		imagedestroy( $image );

		ob_start();
		imagejpeg( $flat, null, 82 );
		$jpeg = (string) ob_get_clean();
		imagedestroy( $flat );

		return $jpeg;
	}

	// ── the operator's side ──────────────────────────────────────────────────

	public static function meta_box(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$screens = array( 'shop_order', 'woocommerce_page_wc-orders' );
		if ( function_exists( 'wc_get_page_screen_id' ) ) {
			$screens[] = wc_get_page_screen_id( 'shop-order' );
		}
		foreach ( array_unique( $screens ) as $screen ) {
			add_meta_box( 'teeshoop-bat', __( 'Bon à tirer', 'teeshoop' ), array( self::class, 'render_box' ), $screen, 'normal', 'high' );
		}
	}

	/** @param mixed $post_or_order */
	public static function render_box( $post_or_order ): void {
		$order = $post_or_order instanceof \WC_Order ? $post_or_order : wc_get_order( $post_or_order );
		if ( ! $order instanceof \WC_Order ) {
			return;
		}

		$versions = self::versions( $order );
		$rounds   = self::corrections( $order );

		if ( empty( $versions ) ) {
			echo '<p>' . esc_html__( 'Aucun bon à tirer n’a encore été envoyé sur cette commande.', 'teeshoop' ) . '</p>';
		} else {
			echo '<table class="widefat striped"><thead><tr>';
			printf( '<th>%s</th><th>%s</th><th>%s</th><th></th>', esc_html__( 'Version', 'teeshoop' ), esc_html__( 'Envoyée le', 'teeshoop' ), esc_html__( 'Réponse', 'teeshoop' ) );
			echo '</tr></thead><tbody>';
			foreach ( array_reverse( $versions ) as $version ) {
				echo '<tr>';
				printf( '<td>%d</td>', (int) $version['version'] );
				printf( '<td>%s</td>', esc_html( Lifecycle::human_date( (string) $version['issued_at'] ) ) );
				echo '<td>' . esc_html( self::answer_label( $version ) ) . '</td>';
				printf(
					'<td><a class="button button-small" href="%s">%s</a></td>',
					esc_url( self::pdf_url( $order, (int) $version['version'] ) ),
					esc_html__( 'Copie PDF', 'teeshoop' )
				);
				echo '</tr>';
				foreach ( (array) ( $version['changes'] ?? array() ) as $change ) {
					printf(
						'<tr><td></td><td colspan="3"><em>%s</em><br>%s</td></tr>',
						esc_html( Lifecycle::human_date( (string) $change['at'] ) ),
						nl2br( esc_html( (string) $change['comment'] ) )
					);
				}
			}
			echo '</tbody></table>';

			printf(
				'<p class="description">%s</p>',
				esc_html(
					$rounds['left'] > 0
						? sprintf(
							/* translators: 1: rounds used, 2: rounds included. */
							__( '%1$d correction(s) demandée(s) sur %2$d incluses.', 'teeshoop' ),
							$rounds['used'],
							$rounds['included']
						)
						: sprintf(
							/* translators: 1: rounds used, 2: rounds included, 3: an amount excl. VAT. */
							__( '%1$d correction(s) demandée(s) pour %2$d incluses. Toute correction supplémentaire est à %3$s HT, à facturer à la main.', 'teeshoop' ),
							$rounds['used'],
							$rounds['included'],
							Money::format( $rounds['next_ht'] )
						)
				)
			);
		}

		$blocked = self::refusal( $order );
		if ( '' !== $blocked ) {
			printf( '<p class="description">%s</p>', esc_html( $blocked ) );
		}

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( self::ACTION_ISSUE );
		printf( '<input type="hidden" name="action" value="%s">', esc_attr( self::ACTION_ISSUE ) );
		printf( '<input type="hidden" name="order_id" value="%d">', (int) $order->get_id() );
		printf( '<p><label for="ts-bat-note">%s</label>', esc_html__( 'Remarque à faire figurer sur le BAT (facultatif)', 'teeshoop' ) );
		echo '<textarea id="ts-bat-note" name="note" rows="2" class="large-text"></textarea></p>';
		printf(
			'<p><button type="submit" class="button button-primary">%s</button></p>',
			esc_html( empty( $versions ) ? __( 'Établir et envoyer le BAT', 'teeshoop' ) : __( 'Établir une nouvelle version et l’envoyer', 'teeshoop' ) )
		);
		echo '</form>';

		/*
		 * THE WAIVER, which is question 26's own written default: « aucune
		 * production sans bon à tirer validé, SAUF accord écrit du client
		 * indiquant qu'il renonce au bon à tirer et en assume le risque ».
		 *
		 * It asks for the customer's own words rather than offering a checkbox,
		 * because a checkbox records that an operator clicked and a quoted
		 * sentence records what the customer said. It is the difference between
		 * evidence and a habit.
		 */
		echo '<hr><form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( self::ACTION_WAIVER );
		printf( '<input type="hidden" name="action" value="%s">', esc_attr( self::ACTION_WAIVER ) );
		printf( '<input type="hidden" name="order_id" value="%d">', (int) $order->get_id() );
		printf( '<p><label for="ts-bat-waiver">%s</label>', esc_html__( 'Renonciation écrite du client au BAT', 'teeshoop' ) );
		echo '<span class="description">' . esc_html__( 'Recopiez ce que le client a écrit, et d’où cela vient (courriel du 12/09, SMS). La production est alors autorisée sans validation.', 'teeshoop' ) . '</span>';
		echo '<textarea id="ts-bat-waiver" name="texte" rows="3" class="large-text"></textarea></p>';
		printf( '<p><button type="submit" class="button">%s</button></p>', esc_html__( 'Enregistrer la renonciation', 'teeshoop' ) );
		echo '</form>';
	}

	/** Where a version stands, for the order screen. */
	private static function answer_label( array $version ): string {
		if ( ! empty( $version['approval'] ) ) {
			return sprintf(
				/* translators: %s: a date and time. */
				__( 'Validé le %s', 'teeshoop' ),
				Lifecycle::human_date( (string) $version['approval']['at'] )
			);
		}
		if ( ! empty( $version['waiver'] ) ) {
			return __( 'Renonciation écrite du client', 'teeshoop' );
		}
		if ( ! empty( $version['changes'] ) ) {
			return __( 'Modifications demandées', 'teeshoop' );
		}
		return strtotime( (string) $version['expires_at'] ) < time()
			? __( 'Sans réponse, lien expiré', 'teeshoop' )
			: __( 'En attente de réponse', 'teeshoop' );
	}

	/** The archive copy, for an operator who can already read the order. */
	public static function pdf_url( \WC_Order $order, int $version ): string {
		return add_query_arg(
			array(
				'action' => self::ACTION_VIEW,
				'c'      => $order->get_id(),
				'v'      => $version,
				'pdf'    => 1,
			),
			admin_url( 'admin-post.php' )
		);
	}

	public static function handle_issue(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de faire cela.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION_ISSUE );

		$order_id = isset( $_POST['order_id'] ) ? absint( wp_unslash( $_POST['order_id'] ) ) : 0;
		$note     = isset( $_POST['note'] ) ? sanitize_textarea_field( wp_unslash( $_POST['note'] ) ) : '';
		$order    = $order_id > 0 ? wc_get_order( $order_id ) : null;
		if ( ! $order instanceof \WC_Order ) {
			wp_die( esc_html__( 'Cette commande n’existe pas.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}

		$issued = self::issue( $order, $note );
		if ( empty( $issued['ok'] ) ) {
			set_transient( 'teeshoop_bat_' . get_current_user_id(), (string) $issued['reason'], 60 );
		} else {
			$sent = Notify::bat( $order, $issued['version'], (string) $issued['token'] );
			set_transient(
				'teeshoop_bat_' . get_current_user_id(),
				$sent['ok']
					? sprintf(
						/* translators: 1: a version number, 2: an e-mail address. */
						__( 'BAT version %1$d envoyé à %2$s.', 'teeshoop' ),
						(int) $issued['version']['version'],
						(string) ( $issued['version']['customer']['email'] ?? '' )
					)
					: sprintf(
						/* translators: 1: a version number, 2: why the send failed. */
						__( 'BAT version %1$d établi, mais l’e-mail n’est pas parti : %2$s. Il est dans la file d’envoi, réessayable.', 'teeshoop' ),
						(int) $issued['version']['version'],
						(string) $sent['reason']
					),
				60
			);
		}

		wp_safe_redirect( Lifecycle::order_url( $order_id ) );
		exit;
	}

	public static function handle_waiver(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de faire cela.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION_WAIVER );

		$order_id = isset( $_POST['order_id'] ) ? absint( wp_unslash( $_POST['order_id'] ) ) : 0;
		$text     = isset( $_POST['texte'] ) ? sanitize_textarea_field( wp_unslash( $_POST['texte'] ) ) : '';
		$order    = $order_id > 0 ? wc_get_order( $order_id ) : null;
		if ( ! $order instanceof \WC_Order ) {
			wp_die( esc_html__( 'Cette commande n’existe pas.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}

		$result = self::record_waiver( $order, $text );
		set_transient( 'teeshoop_bat_' . get_current_user_id(), $result['ok'] ? __( 'Renonciation enregistrée. La production est autorisée.', 'teeshoop' ) : $result['reason'], 60 );
		wp_safe_redirect( Lifecycle::order_url( $order_id ) );
		exit;
	}

	/**
	 * Record what the customer wrote when they waived the proof.
	 *
	 * REFUSES AN EMPTY ONE, and that refusal is the whole feature. Question 26's
	 * default authorises production without an approved proof only « sauf accord
	 * écrit du client » : with no words there is no written agreement, and a
	 * waiver that records nothing is a click that removes the only gate standing
	 * between a paid order and a press.
	 *
	 * @return array{ok:bool,reason:string}
	 */
	public static function record_waiver( \WC_Order $order, string $text ): array {
		$text = trim( $text );
		if ( mb_strlen( $text ) < 15 ) {
			return array(
				'ok'     => false,
				'reason' => __( 'Recopiez l’accord écrit du client, et d’où il vient. Sans ses mots, il n’y a pas d’accord écrit et la production reste bloquée.', 'teeshoop' ),
			);
		}

		if ( ! Invoice::lock( self::lock_name( $order ) ) ) {
			return array(
				'ok'     => false,
				'reason' => self::BUSY_REASON,
			);
		}
		$order    = wc_get_order( $order->get_id() ) ?: $order;
		$versions = self::versions( $order );
		if ( empty( $versions ) ) {
			Invoice::unlock( self::lock_name( $order ) );
			return array(
				'ok'     => false,
				'reason' => __( 'Établissez d’abord le bon à tirer : une renonciation porte sur un document, pas sur rien.', 'teeshoop' ),
			);
		}

		$last = count( $versions ) - 1;
		$versions[ $last ]['waiver'] = array(
			'at'   => gmdate( 'c' ),
			'by'   => function_exists( 'get_current_user_id' ) ? get_current_user_id() : 0,
			'text' => mb_substr( $text, 0, self::COMMENT_MAX ),
		);
		/*
		 * AND THE LINK DIES WITH IT. A waiver means somebody took the agreement
		 * by telephone or by e-mail and the press is being opened; leaving the
		 * proof link live left the customer able to open it and press « Demander
		 * des modifications » on a document already in production. They would
		 * have every reason to believe they had stopped it.
		 */
		$versions[ $last ]['tokens'] = array();
		$order->update_meta_data( self::META_VERSIONS, wp_json_encode( $versions ) );
		$order->save();
		Invoice::unlock( self::lock_name( $order ) );

		$order->add_order_note(
			sprintf(
				/* translators: %s: what the customer wrote. */
				__( 'Renonciation au BAT enregistrée : %s', 'teeshoop' ),
				$text
			)
		);

		Lifecycle::transition(
			$order,
			Lifecycle::APPROVED,
			array(
				'source' => 'atelier',
				'reason' => __( 'Renonciation écrite du client au BAT', 'teeshoop' ),
			)
		);

		return array(
			'ok'     => true,
			'reason' => '',
		);
	}
}
