<?php
/**
 * What the shop writes to people, and when.
 *
 * SEPARATE FROM `Mail` ON PURPOSE. That file knows how a message leaves and what
 * happened to it; this one knows what it says. The split is what lets a retry
 * REBUILD a message rather than replay a stored copy, which is the only way the
 * outbox can avoid holding a table of live approval links.
 *
 * ONE COMPOSER PER MESSAGE, called by both the send and the retry. Two copies of
 * a wording is how a retry starts saying something the first attempt did not,
 * and a customer comparing the two would be right to wonder which is the offer.
 *
 * WRITTEN HERE, NOT TEMPLATED IN BREVO. Brevo can hold the templates and it
 * would be one less thing to build. It would also put every sentence a customer
 * reads in a web interface that is not in this repository, cannot be reviewed in
 * a diff, cannot be tested, and is edited by whoever has the password.
 *
 * ONE PALETTE, RESTATED AS LITERAL HEX. `assets/product.css` is a linked
 * stylesheet built on custom properties and a media query, and none of those
 * three survives a mail client. So the colours are written out here, once, and
 * the layout is a table because that is what Outlook renders.
 *
 * THE HTML AND THE TEXT SAY THE SAME THING. A text part that is a stub is a
 * message half the recipients cannot read, and on a business list a fair number
 * of them are on a client that shows it.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Notify {

	/** The kinds. Also what the outbox stores and what a retry rebuilds. */
	public const KIND_CONFIRM  = 'confirmation';
	public const KIND_BAT      = 'bat';
	public const KIND_RECEIPT  = 'bat-recu';
	public const KIND_CHANGES  = 'bat-modifs';
	public const KIND_SHIPPED  = 'expedition';
	public const KIND_WORKSHOP = 'atelier';

	/** Order meta: what an operator typed off the carrier's label. */
	public const META_TRACKING = '_teeshoop_suivi';
	public const META_CARRIER  = '_teeshoop_transporteur';

	public static function init(): void {
		/*
		 * The confirmation rides on the MONEY, not on a status. WooCommerce
		 * sends its own "order received"; ours is the one that says what happens
		 * next in our process, which is that a proof is coming and that nothing
		 * is printed before they answer it.
		 */
		add_action( 'woocommerce_payment_complete', array( self::class, 'on_paid' ), 30, 1 );
		add_action( 'teeshoop_bat_approved', array( self::class, 'on_approved' ), 10, 2 );
		add_action( 'teeshoop_bat_changes', array( self::class, 'on_changes' ), 10, 2 );
		// Three arguments, and the third is the point. See `on_shipped`.
		add_action( 'woocommerce_order_status_' . Lifecycle::SHIPPED, array( self::class, 'on_shipped' ), 10, 3 );
	}

	// ── the messages ─────────────────────────────────────────────────────────

	/**
	 * The proof, with the link that approves it.
	 *
	 * @return array{ok:bool,reason:string,id:int}
	 */
	/**
	 * @param ?string $environment threaded, not read, for the reason
	 *                `Mail::deliver` takes one: Brevo runs in production and
	 *                nowhere else, so a suite asserting the Brevo request has to
	 *                be able to say which environment it is standing in without
	 *                restating the message.
	 */
	public static function bat( \WC_Order $order, array $version, string $token, ?string $environment = null ): array {
		return Mail::send( self::message( self::spec_bat( $order, $version, $token ), $order, self::KIND_BAT ), $environment );
	}

	public static function confirmation( \WC_Order $order ): array {
		return Mail::send( self::message( self::spec_confirmation( $order ), $order, self::KIND_CONFIRM ) );
	}

	public static function receipt( \WC_Order $order, array $version ): array {
		return Mail::send( self::message( self::spec_receipt( $order, $version ), $order, self::KIND_RECEIPT ) );
	}

	public static function changes( \WC_Order $order, array $version ): array {
		return Mail::send( self::message( self::spec_changes( $order, $version ), $order, self::KIND_CHANGES ) );
	}

	public static function shipped( \WC_Order $order ): array {
		return Mail::send( self::message( self::spec_shipped( $order ), $order, self::KIND_SHIPPED ) );
	}

	/**
	 * The workshop's own alerts.
	 *
	 * They go to an address rather than to a screen, because the person who has
	 * to act is not sitting in the admin waiting for something to appear.
	 */
	public static function workshop( \WC_Order $order, string $heading, array $lines ): array {
		$spec = array(
			'subject' => sprintf( '[Teeshoop] %s, commande %s', $heading, $order->get_order_number() ),
			'heading' => $heading,
			'lines'   => array_values( array_filter( $lines ) ),
			'cta'     => array(
				'label' => 'Ouvrir la commande',
				'url'   => Lifecycle::order_url( $order->get_id() ),
			),
		);

		return Mail::send(
			array(
				'kind'     => self::KIND_WORKSHOP,
				'order_id' => $order->get_id(),
				'to'       => Mail::workshop_address(),
				'to_name'  => '',
				'subject'  => (string) $spec['subject'],
				'html'     => self::html( $spec ),
				'text'     => self::text( $spec ),
			)
		);
	}

	// ── the composers ────────────────────────────────────────────────────────

	private static function spec_bat( \WC_Order $order, array $version, string $token ): array {
		$number = (string) ( $version['order']['number'] ?? $order->get_order_number() );
		$lines  = array(
			1 === (int) $version['version']
				? 'Votre bon à tirer est prêt. Regardez-le, puis validez-le : nous n’imprimons rien avant.'
				: sprintf( 'Voici la version %d de votre bon à tirer, avec les modifications que vous nous avez demandées.', (int) $version['version'] ),
			'Vérifiez le visuel, sa taille, sa position, la couleur du vêtement, les tailles et les quantités.',
		);
		if ( '' !== trim( (string) ( $version['note'] ?? '' ) ) ) {
			$lines[] = 'De notre côté : ' . (string) $version['note'];
		}
		$lines[] = sprintf( 'Ce lien reste actif jusqu’au %s.', Lifecycle::human_date( (string) $version['expires_at'] ) );

		return array(
			'subject'  => sprintf( 'Votre bon à tirer, commande %s', $number ),
			'heading'  => 'Bon à tirer à valider',
			'lines'    => $lines,
			'cta'      => array(
				'label' => 'Voir et valider le bon à tirer',
				'url'   => Bat::url( $order, (int) $version['version'], $token ),
			),
			'footnote' => 'Si vous préférez des modifications, le même lien vous permet de nous les écrire.',
		);
	}

	private static function spec_confirmation( \WC_Order $order ): array {
		return array(
			'subject' => sprintf( 'Commande %s : c’est réglé, voici la suite', $order->get_order_number() ),
			'heading' => 'Merci, votre commande est enregistrée',
			'lines'   => array(
				'Votre paiement est bien arrivé.',
				'Nous préparons maintenant votre bon à tirer : une image de votre vêtement avec votre visuel à sa vraie place, et les dimensions en centimètres.',
				'Vous le recevrez par courriel. Rien n’est imprimé tant que vous ne l’avez pas validé.',
			),
			'cta'     => array(
				'label' => 'Voir votre commande',
				'url'   => $order->get_view_order_url(),
			),
		);
	}

	private static function spec_receipt( \WC_Order $order, array $version ): array {
		return array(
			'subject'  => sprintf( 'Bon à tirer validé, commande %s', $order->get_order_number() ),
			'heading'  => 'Bon à tirer validé',
			'lines'    => array(
				sprintf(
					'Nous avons enregistré votre validation du %s, sur la version %d du bon à tirer.',
					Lifecycle::human_date( (string) ( $version['approval']['at'] ?? '' ) ),
					(int) $version['version']
				),
				'La production est lancée. Nous vous écrivons de nouveau au départ du colis, avec le numéro de suivi.',
			),
			'footnote' => 'Gardez ce message : c’est la trace de ce qui a été approuvé.',
		);
	}

	private static function spec_changes( \WC_Order $order, array $version ): array {
		$changes = (array) ( $version['changes'] ?? array() );
		$last    = end( $changes );
		$lines   = array(
			'Nous avons bien reçu votre demande de modification. Rien n’est imprimé.',
			'Nous préparons une nouvelle version du bon à tirer et nous vous la renvoyons ici même.',
		);
		if ( ! empty( $last['comment'] ) ) {
			$lines[] = 'Ce que vous nous avez écrit : « ' . (string) $last['comment'] . ' »';
		}

		return array(
			'subject' => sprintf( 'Vos modifications sont bien arrivées, commande %s', $order->get_order_number() ),
			'heading' => 'Modifications reçues',
			'lines'   => $lines,
		);
	}

	private static function spec_shipped( \WC_Order $order ): array {
		$tracking = self::tracking( $order );
		$lines    = array( 'Votre commande est partie.' );
		if ( '' !== $tracking['number'] ) {
			$lines[] = sprintf( 'Numéro de suivi %s, %s.', $tracking['number'], $tracking['carrier'] );
		} else {
			/*
			 * THE ABSENCE IS SAID OUT LOUD. A dispatch e-mail with an empty
			 * tracking line reads like a broken message; one that admits there
			 * is no number yet reads like a shop that knows where its parcel is.
			 */
			$lines[] = 'Le numéro de suivi n’est pas encore disponible. Nous vous l’envoyons dès que le transporteur nous le donne.';
		}

		return array(
			'subject' => sprintf( 'Commande %s expédiée', $order->get_order_number() ),
			'heading' => 'Votre commande est en route',
			'lines'   => $lines,
			'cta'     => '' !== $tracking['url'] ? array(
				'label' => 'Suivre le colis',
				'url'   => $tracking['url'],
			) : null,
		);
	}

	// ── the events ───────────────────────────────────────────────────────────

	/** @param int $order_id */
	public static function on_paid( $order_id ): void {
		$order = wc_get_order( $order_id );
		if ( ! $order instanceof \WC_Order ) {
			return;
		}
		self::confirmation( $order );
		self::workshop(
			$order,
			'Commande payée, bon à tirer à établir',
			array(
				sprintf( 'La commande %s est payée et attend son bon à tirer.', $order->get_order_number() ),
				'Rien ne peut partir en production avant que le client l’ait validé.',
			)
		);
	}

	/** @param mixed $order */
	public static function on_approved( $order, $version ): void {
		if ( ! $order instanceof \WC_Order ) {
			return;
		}
		$version = (array) $version;
		self::receipt( $order, $version );
		self::workshop(
			$order,
			'BAT validé, production autorisée',
			array(
				sprintf( 'Le client a validé la version %d du bon à tirer.', (int) ( $version['version'] ?? 0 ) ),
				'La commande peut passer en production.',
			)
		);
	}

	/** @param mixed $order */
	public static function on_changes( $order, $version ): void {
		if ( ! $order instanceof \WC_Order ) {
			return;
		}
		$version = (array) $version;
		self::changes( $order, $version );
		$changes = (array) ( $version['changes'] ?? array() );
		$last    = end( $changes );
		self::workshop(
			$order,
			'Modifications demandées sur le BAT',
			array(
				'Le client a demandé des modifications. La production est bloquée.',
				! empty( $last['comment'] ) ? 'Sa demande : ' . (string) $last['comment'] : '',
			)
		);
	}

	/**
	 * @param int   $order_id
	 * @param mixed $order
	 * @param array $transition WooCommerce's own from/to, third argument of
	 *                          `woocommerce_order_status_{$status}`.
	 */
	public static function on_shipped( $order_id, $order = null, $transition = null ): void {
		/*
		 * A TRANSITION THAT DID NOT MOVE IS NOT A DISPATCH.
		 *
		 * `Lifecycle::guard` refuses an illegal status change by putting the
		 * stored status back, which makes WooCommerce's pending transition
		 * from-equals-to and fires this hook for the status the order was
		 * already in. An operator picking « Annulée » on a shipped order would
		 * therefore have sent the customer a second « votre commande est en
		 * route ». `silence_woo_email` covers WooCommerce's own two e-mails and
		 * could never have covered ours; this is our half of it, and it is on
		 * the listener because that is where the fact is known.
		 */
		if ( is_array( $transition ) && isset( $transition['from'], $transition['to'] ) && $transition['from'] === $transition['to'] ) {
			return;
		}
		$order = $order instanceof \WC_Order ? $order : wc_get_order( $order_id );
		if ( $order instanceof \WC_Order ) {
			self::shipped( $order );
		}
	}

	// ── retrying ─────────────────────────────────────────────────────────────

	/**
	 * Build a message again FOR SENDING, from the order as it is now.
	 *
	 * IT HAS A SIDE EFFECT AND THE NAME HAS TO CARRY IT. Rebuilding a proof
	 * e-mail mints a NEW approval link, because the original token was kept only
	 * as a digest and cannot be recovered. That is exactly right for a retry:
	 * the previous message did not arrive, so nobody holds the old link. It is
	 * exactly wrong for anything that only wants to LOOK at a message, and this
	 * was found the hard way, by a harness that asked for a preview and killed
	 * the live link it was about to click. Reading is `render()`.
	 *
	 * A kind with no rebuilder is refused by name rather than skipped, because
	 * an internal alert nobody can resend is a thing an operator should be told
	 * about rather than a row that quietly stops moving.
	 *
	 * @return array{ok:bool,message?:array,reason?:string}
	 */
	/**
	 * Whether a kind can ever be rebuilt.
	 *
	 * Separate from `rebuild()` returning false, because the two mean different
	 * things: this one is "no code exists to make this message again", which
	 * never changes, and that one is also used for "this proof has been
	 * answered" and "the sender address is not verified yet", which do.
	 * `Mail::retry` needs to tell them apart to know whether to keep trying.
	 */
	public static function rebuildable( string $kind ): bool {
		return in_array( $kind, array( self::KIND_BAT, self::KIND_CONFIRM, self::KIND_SHIPPED, self::KIND_RECEIPT, self::KIND_CHANGES ), true );
	}

	public static function rebuild( string $kind, int $order_id ): array {
		$order = $order_id > 0 ? wc_get_order( $order_id ) : null;
		if ( ! $order instanceof \WC_Order ) {
			return array(
				'ok'     => false,
				'reason' => 'La commande de ce message n’existe plus.',
			);
		}

		if ( self::KIND_BAT === $kind ) {
			$again = Bat::resend( $order );
			if ( empty( $again['ok'] ) ) {
				return array(
					'ok'     => false,
					'reason' => (string) $again['reason'],
				);
			}
			return array(
				'ok'      => true,
				'message' => self::message( self::spec_bat( $order, (array) $again['version'], (string) $again['token'] ), $order, $kind ),
			);
		}

		return self::render( $kind, $order_id );
	}

	/**
	 * The same message, rendered and NOTHING ELSE.
	 *
	 * No token minted, no order touched, no row written. This is what a preview,
	 * a screenshot harness or a future operator-facing "see what the customer
	 * got" reads. The proof e-mail is rendered with whatever token it is handed,
	 * and with none it carries a link that opens nothing, which is the honest
	 * thing for a document nobody is being asked to act on.
	 *
	 * @return array{ok:bool,message?:array,reason?:string}
	 */
	public static function render( string $kind, int $order_id, string $token = '' ): array {
		$order = $order_id > 0 ? wc_get_order( $order_id ) : null;
		if ( ! $order instanceof \WC_Order ) {
			return array(
				'ok'     => false,
				'reason' => 'La commande de ce message n’existe plus.',
			);
		}

		if ( self::KIND_BAT === $kind ) {
			$current = Bat::current( $order );
			if ( null === $current ) {
				return array(
					'ok'     => false,
					'reason' => 'Aucun bon à tirer n’a été établi sur cette commande.',
				);
			}
			return array(
				'ok'      => true,
				'message' => self::message( self::spec_bat( $order, $current, $token ), $order, $kind ),
			);
		}

		if ( self::KIND_CONFIRM === $kind ) {
			return array(
				'ok'      => true,
				'message' => self::message( self::spec_confirmation( $order ), $order, $kind ),
			);
		}

		if ( self::KIND_SHIPPED === $kind ) {
			return array(
				'ok'      => true,
				'message' => self::message( self::spec_shipped( $order ), $order, $kind ),
			);
		}

		if ( self::KIND_RECEIPT === $kind || self::KIND_CHANGES === $kind ) {
			$current = Bat::current( $order );
			if ( null === $current ) {
				return array(
					'ok'     => false,
					'reason' => 'Ce bon à tirer n’existe plus : il n’y a plus d’accusé à envoyer.',
				);
			}
			if ( self::KIND_RECEIPT === $kind && empty( $current['approval'] ) ) {
				return array(
					'ok'     => false,
					'reason' => 'Ce bon à tirer n’est plus validé : envoyer un accusé de validation serait faux.',
				);
			}
			return array(
				'ok'      => true,
				'message' => self::message(
					self::KIND_RECEIPT === $kind ? self::spec_receipt( $order, $current ) : self::spec_changes( $order, $current ),
					$order,
					$kind
				),
			);
		}

		return array(
			'ok'     => false,
			'reason' => sprintf( 'Un message interne (%s) ne se renvoie pas tout seul : refaites l’action sur la commande.', $kind ),
		);
	}

	// ── rendering ────────────────────────────────────────────────────────────

	private static function message( array $spec, \WC_Order $order, string $kind ): array {
		return array(
			'kind'     => $kind,
			'order_id' => $order->get_id(),
			'to'       => $order->get_billing_email(),
			'to_name'  => trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ),
			'subject'  => (string) $spec['subject'],
			'html'     => self::html( $spec ),
			'text'     => self::text( $spec ),
		);
	}

	/**
	 * The HTML part.
	 *
	 * A TABLE, INLINE STYLES, ONE COLUMN, 600 px. Not a stylistic choice: Outlook
	 * renders mail through Word, which supports no flexbox, no grid and no
	 * external stylesheet, and Gmail strips `<style>` blocks on some clients. A
	 * message that has to reach a business inbox is written the way business
	 * inboxes render.
	 */
	public static function html( array $spec ): string {
		$ink   = '#14171a';
		$soft  = '#5b6470';
		$line  = '#dce0e5';
		$wash  = '#f6f7f9';
		$blue  = '#1f4fd8';

		$out  = '<!doctype html><html lang="fr"><head><meta charset="utf-8">';
		$out .= '<meta name="viewport" content="width=device-width, initial-scale=1">';
		$out .= '<title>' . esc_html( (string) $spec['subject'] ) . '</title></head>';
		$out .= '<body style="margin:0;padding:0;background:' . $wash . ';">';
		$out .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' . $wash . ';">';
		$out .= '<tr><td align="center" style="padding:24px 12px;">';
		$out .= '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ' . $line . ';">';

		$out .= '<tr><td style="padding:24px 24px 8px 24px;font:600 13px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:' . $soft . ';">Teeshoop</td></tr>';
		$out .= '<tr><td style="padding:0 24px 8px 24px;font:600 22px/1.3 Helvetica,Arial,sans-serif;color:' . $ink . ';">' . esc_html( (string) $spec['heading'] ) . '</td></tr>';

		foreach ( (array) $spec['lines'] as $paragraph ) {
			if ( '' === trim( (string) $paragraph ) ) {
				continue;
			}
			$out .= '<tr><td style="padding:6px 24px;font:400 16px/1.55 Helvetica,Arial,sans-serif;color:' . $ink . ';">' . esc_html( (string) $paragraph ) . '</td></tr>';
		}

		$cta = $spec['cta'] ?? null;
		if ( is_array( $cta ) && ! empty( $cta['url'] ) ) {
			$out .= '<tr><td style="padding:18px 24px 6px 24px;">';
			$out .= '<a href="' . esc_url( (string) $cta['url'] ) . '" style="display:inline-block;background:' . $blue . ';color:#ffffff;text-decoration:none;padding:14px 22px;font:600 16px/1 Helvetica,Arial,sans-serif;">' . esc_html( (string) $cta['label'] ) . '</a>';
			$out .= '</td></tr>';
			/*
			 * THE ADDRESS IN FULL, UNDER THE BUTTON. A proof link is what the
			 * whole order waits on, and a mail client that strips the button, a
			 * forwarded message, or a printout leaves the recipient with no way
			 * to reach it. It costs one grey line.
			 */
			$out .= '<tr><td style="padding:0 24px 14px 24px;font:400 12px/1.5 Helvetica,Arial,sans-serif;color:' . $soft . ';word-break:break-all;">' . esc_html( (string) $cta['url'] ) . '</td></tr>';
		}

		if ( ! empty( $spec['footnote'] ) ) {
			$out .= '<tr><td style="padding:6px 24px 20px 24px;font:400 14px/1.5 Helvetica,Arial,sans-serif;color:' . $soft . ';">' . esc_html( (string) $spec['footnote'] ) . '</td></tr>';
		}

		$out .= '<tr><td style="padding:16px 24px 22px 24px;border-top:1px solid ' . $line . ';font:400 13px/1.5 Helvetica,Arial,sans-serif;color:' . $soft . ';">';
		$out .= esc_html( self::signature() );
		$out .= '</td></tr></table></td></tr></table></body></html>';

		return $out;
	}

	/** The text part. The same words, in the same order. */
	public static function text( array $spec ): string {
		$out = (string) $spec['heading'] . "\n\n";
		foreach ( (array) $spec['lines'] as $paragraph ) {
			if ( '' === trim( (string) $paragraph ) ) {
				continue;
			}
			$out .= (string) $paragraph . "\n\n";
		}
		$cta = $spec['cta'] ?? null;
		if ( is_array( $cta ) && ! empty( $cta['url'] ) ) {
			$out .= (string) $cta['label'] . " :\n" . (string) $cta['url'] . "\n\n";
		}
		if ( ! empty( $spec['footnote'] ) ) {
			$out .= (string) $spec['footnote'] . "\n\n";
		}
		return $out . self::signature() . "\n";
	}

	/**
	 * Who is writing.
	 *
	 * Reads `Legal::identity()`, which is empty until the associate answers
	 * question 17, and prints only what is filled in. A placeholder address in
	 * the footer of a transactional e-mail is a false statement to a customer
	 * about who they bought from.
	 */
	private static function signature(): string {
		$identity = Legal::identity();
		$parts    = array_filter(
			array(
				$identity['raison_sociale'],
				trim( $identity['adresse'] . ' ' . $identity['code_postal'] . ' ' . $identity['ville'] ),
			)
		);
		return empty( $parts ) ? 'Teeshoop' : implode( ', ', $parts );
	}

	/**
	 * The carrier and the parcel number, from the order.
	 *
	 * Read from meta an operator fills in. There is no carrier API yet, and
	 * question 14 has no answer either, so this is the honest shape: the shop
	 * states what somebody typed and says nothing when nobody has typed
	 * anything.
	 *
	 * @return array{carrier:string,number:string,url:string}
	 */
	public static function tracking( \WC_Order $order ): array {
		$number  = trim( (string) $order->get_meta( self::META_TRACKING, true ) );
		$carrier = trim( (string) $order->get_meta( self::META_CARRIER, true ) );
		if ( '' === $carrier ) {
			$carrier = 'Colissimo';
		}
		$url = '';
		if ( '' !== $number && 'Colissimo' === $carrier ) {
			$url = 'https://www.laposte.fr/outils/suivre-vos-envois?code=' . rawurlencode( $number );
		}
		return array(
			'carrier' => $carrier,
			'number'  => $number,
			'url'     => $url,
		);
	}
}
