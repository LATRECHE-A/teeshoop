<?php
/**
 * Every message this shop sends, and what happened to it.
 *
 * THE OUTBOX IS THE FEATURE, not the transport. The classic WordPress failure
 * is a `wp_mail()` whose return value nobody reads: the customer is never told,
 * the shop believes they were, and the order stalls for ever with nobody
 * knowing. `Quote::notify` does exactly that today, deliberately, because the
 * record is written first and the mail is only a notification about it. A bon à
 * tirer is not like that. If it does not arrive, nothing else happens: no
 * approval, no production, no parcel, and the first symptom is a customer
 * ringing three weeks later.
 *
 * So every send is a row before it is a request, the row keeps the answer, the
 * failures have a screen, and a failure can be tried again.
 *
 * THE ROW DOES NOT KEEP THE MESSAGE. It keeps who, what kind, when and what
 * went wrong; a retry re-renders from the order. That is not an economy, it is
 * the security property: the proof e-mail carries a capability URL, and a table
 * of rendered message bodies would be a table of live approval links, kept in
 * every backup. The cost is that a retry mints a new link and kills the old
 * one, which only matters if the first message actually arrived, and a retry
 * only runs when it did not.
 *
 * BREVO, AND `wp_mail` ONLY WHERE THERE IS NOTHING TO LOSE. Development and
 * preproduction have no API key and must still be able to run a whole order
 * through; production with no key sends nothing and says so, because a shop
 * quietly falling back to a shared-hosting sendmail is a shop whose proof
 * e-mails land in spam and whose operator believes they were sent. Same shape
 * as `Legal::verdict`: what an incomplete configuration does depends on where
 * it is running.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Mail {

	/** Queued, never attempted. */
	public const QUEUED = 'queued';

	/** The provider took it. */
	public const SENT = 'sent';

	/** It did not go, and the row says why. */
	public const FAILED = 'failed';

	/** How many times a message is retried before it waits for a human. */
	private const MAX_ATTEMPTS = 5;

	/** The retry pass. */
	private const CRON = 'teeshoop_mail_retry';

	/** Schema version of the outbox table. */
	private const DB_VERSION = '1';

	/** The admin action behind the retry button. */
	public const ACTION_RETRY = 'teeshoop_mail_retry_now';

	public static function init(): void {
		add_action( 'plugins_loaded', array( self::class, 'maybe_install' ), 20 );
		add_action( self::CRON, array( self::class, 'retry_pass' ) );
		add_action( 'init', array( self::class, 'schedule' ) );
		add_action( 'admin_post_' . self::ACTION_RETRY, array( self::class, 'handle_retry' ) );
		add_action( 'admin_notices', array( self::class, 'stuck_notice' ) );
		add_action( 'admin_menu', array( self::class, 'menu' ) );
	}

	public static function table(): string {
		global $wpdb;
		return $wpdb->prefix . 'teeshoop_mail';
	}

	/**
	 * Create the table if it is not there.
	 *
	 * On `plugins_loaded` and not on activation, the same as `Invoice`: a site
	 * where the plugin was already active never runs an activation hook again,
	 * so a table added later would never exist there and the failure would be a
	 * silent one on the day it mattered.
	 */
	public static function maybe_install(): void {
		if ( get_option( 'teeshoop_mail_db' ) === self::DB_VERSION ) {
			return;
		}
		self::install();
		update_option( 'teeshoop_mail_db', self::DB_VERSION, false );
	}

	public static function install(): void {
		global $wpdb;
		$table   = self::table();
		$collate = $wpdb->get_charset_collate();
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"CREATE TABLE IF NOT EXISTS {$table} (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				created_at DATETIME NOT NULL,
				sent_at DATETIME NULL,
				kind VARCHAR(40) NOT NULL,
				order_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
				recipient VARCHAR(190) NOT NULL,
				subject VARCHAR(255) NOT NULL,
				status VARCHAR(16) NOT NULL,
				attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
				transport VARCHAR(16) NOT NULL DEFAULT '',
				message_id VARCHAR(120) NOT NULL DEFAULT '',
				last_error TEXT NULL,
				PRIMARY KEY (id),
				KEY status_created (status, created_at),
				KEY order_kind (order_id, kind)
			) {$collate}"
		);
	}

	public static function schedule(): void {
		if ( ! wp_next_scheduled( self::CRON ) ) {
			wp_schedule_event( time() + 5 * MINUTE_IN_SECONDS, 'hourly', self::CRON );
		}
	}

	/** The cron name, so the deactivation hook can unschedule it by name. */
	public static function cron(): string {
		return self::CRON;
	}

	// ── sending ──────────────────────────────────────────────────────────────

	/**
	 * Send one message, and remember what happened either way.
	 *
	 * @param array $message kind, order_id, to, to_name, subject, html, text.
	 *
	 * @return array{ok:bool,reason:string,id:int}
	 */
	public static function send( array $message, ?string $environment = null ): array {
		$id = self::record( $message );

		$to = (string) ( $message['to'] ?? '' );
		if ( '' === $to || ! is_email( $to ) ) {
			self::finish( $id, self::FAILED, '', '', 'Aucune adresse e-mail valable sur la commande.' );
			return array(
				'ok'     => false,
				'reason' => 'Aucune adresse e-mail valable sur la commande.',
				'id'     => $id,
			);
		}

		$result = self::deliver( $message, $environment );
		self::finish(
			$id,
			$result['ok'] ? self::SENT : self::FAILED,
			$result['transport'],
			$result['message_id'],
			$result['reason']
		);

		return array(
			'ok'     => $result['ok'],
			'reason' => $result['reason'],
			'id'     => $id,
		);
	}

	/**
	 * Hand the message to whatever can carry it.
	 *
	 * `$environment` is a parameter rather than a call to `wp_get_environment_type()`
	 * for the reason `Invoice::compose` and `Legal::verdict` already take one: the
	 * behaviour DEPENDS on it, so a suite that cannot vary it can only ever prove
	 * one of the three answers, and the one it would prove is the developer's.
	 *
	 * @return array{ok:bool,reason:string,transport:string,message_id:string}
	 */
	private static function deliver( array $message, ?string $environment = null ): array {
		$key = self::api_key();
		if ( '' !== $key ) {
			return self::brevo( $message, $key );
		}

		$environment = null === $environment ? Legal::environment() : $environment;
		if ( 'production' === $environment ) {
			/*
			 * FAIL CLOSED, and loudly. An unset secret denies everything: the
			 * message is not sent by some other route, it is recorded as failed
			 * with the name of the constant that is missing, and the admin
			 * screen shows it. `if ( ! $key ) { fall back }` is the inversion
			 * this project forbids by name.
			 */
			return array(
				'ok'         => false,
				'reason'     => 'TEESHOOP_BREVO_KEY n’est pas définie dans wp-config.php : rien n’a été envoyé.',
				'transport'  => '',
				'message_id' => '',
			);
		}

		return self::wp_mail_fallback( $message, $environment );
	}

	/**
	 * `POST https://api.brevo.com/v3/smtp/email`.
	 *
	 * @return array{ok:bool,reason:string,transport:string,message_id:string}
	 */
	private static function brevo( array $message, string $key ): array {
		$from = self::sender();
		if ( '' === $from['email'] ) {
			return array(
				'ok'         => false,
				'reason'     => 'Aucune adresse d’expédition configurée (réglage mail_from).',
				'transport'  => 'brevo',
				'message_id' => '',
			);
		}

		$body = array(
			'sender'      => array(
				'name'  => $from['name'],
				'email' => $from['email'],
			),
			'to'          => array(
				array_filter(
					array(
						'email' => (string) $message['to'],
						'name'  => (string) ( $message['to_name'] ?? '' ),
					)
				),
			),
			'subject'     => (string) $message['subject'],
			'htmlContent' => (string) $message['html'],
			'textContent' => (string) $message['text'],
		);
		if ( '' !== $from['reply_to'] ) {
			$body['replyTo'] = array( 'email' => $from['reply_to'] );
		}

		$response = wp_remote_post(
			'https://api.brevo.com/v3/smtp/email',
			array(
				'timeout'     => 15,
				'redirection' => 0,
				'headers'     => array(
					'api-key'      => $key,
					'accept'       => 'application/json',
					'content-type' => 'application/json',
				),
				'body'        => wp_json_encode( $body ),
			)
		);

		if ( is_wp_error( $response ) ) {
			// A transport failure is not a refusal: we do not know whether it
			// went. It is retried, and the row says which of the two it was.
			return array(
				'ok'         => false,
				'reason'     => 'Brevo injoignable : ' . $response->get_error_message(),
				'transport'  => 'brevo',
				'message_id' => '',
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$json = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $code && 201 !== $code && 202 !== $code ) {
			/*
			 * 4xx IS OURS TO FIX AND 5xx IS THEIRS. Both are recorded with the
			 * code and Brevo's own message, because "the e-mail did not go" is
			 * useless to an operator and "401, clé invalide" tells them exactly
			 * what to do. A 400 on an unverified sender address is the one that
			 * happens on the first real send, and nothing else would explain it.
			 */
			$detail = is_array( $json ) && isset( $json['message'] ) ? (string) $json['message'] : '';
			return array(
				'ok'         => false,
				'reason'     => sprintf( 'Brevo a refusé l’envoi (HTTP %d)%s', $code, '' !== $detail ? ' : ' . $detail : '' ),
				'transport'  => 'brevo',
				'message_id' => '',
			);
		}

		return array(
			'ok'         => true,
			'reason'     => '',
			'transport'  => 'brevo',
			'message_id' => is_array( $json ) && isset( $json['messageId'] ) ? (string) $json['messageId'] : '',
		);
	}

	/**
	 * The development transport.
	 *
	 * Only reachable outside production, and it records itself as `wp_mail` so
	 * nobody reads a green outbox on a machine that never had an API key and
	 * concludes the shop can send.
	 *
	 * @return array{ok:bool,reason:string,transport:string,message_id:string}
	 */
	private static function wp_mail_fallback( array $message, string $environment ): array {
		$from = self::sender();
		$headers = array( 'Content-Type: text/html; charset=UTF-8' );
		if ( '' !== $from['email'] ) {
			$headers[] = sprintf( 'From: %s <%s>', $from['name'], $from['email'] );
		}
		$ok = wp_mail( (string) $message['to'], (string) $message['subject'], (string) $message['html'], $headers );

		return array(
			'ok'         => (bool) $ok,
			'reason'     => $ok ? '' : sprintf( 'wp_mail a échoué (environnement %s, aucune clé Brevo).', $environment ),
			'transport'  => 'wp_mail',
			'message_id' => '',
		);
	}

	/**
	 * The Brevo key.
	 *
	 * A CONSTANT AND NEVER AN OPTION, the same as `TEESHOOP_CATALOGUE_TOKEN`:
	 * options are dumped by every backup, editable from the admin, and visible
	 * to anyone who reaches the database, and this one can send mail as us to
	 * anybody. Returns '' when unset so every caller fails closed.
	 */
	public static function api_key(): string {
		return defined( 'TEESHOOP_BREVO_KEY' ) ? trim( (string) constant( 'TEESHOOP_BREVO_KEY' ) ) : '';
	}

	/** Who the shop writes as. */
	public static function sender(): array {
		$name = Settings::get( 'mail_from_name' );
		return array(
			'email'    => Settings::get( 'mail_from' ),
			'name'     => '' !== $name ? $name : 'Teeshoop',
			'reply_to' => Settings::get( 'mail_reply_to' ),
		);
	}

	/** Where an internal alert goes. */
	public static function workshop_address(): string {
		$set = Settings::get( 'mail_atelier' );
		return '' !== $set ? $set : (string) get_option( 'admin_email' );
	}

	// ── the outbox ───────────────────────────────────────────────────────────

	private static function record( array $message ): int {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->insert(
			self::table(),
			array(
				'created_at' => gmdate( 'Y-m-d H:i:s' ),
				'kind'       => mb_substr( (string) ( $message['kind'] ?? 'inconnu' ), 0, 40 ),
				'order_id'   => (int) ( $message['order_id'] ?? 0 ),
				'recipient'  => mb_substr( (string) ( $message['to'] ?? '' ), 0, 190 ),
				'subject'    => mb_substr( (string) ( $message['subject'] ?? '' ), 0, 255 ),
				'status'     => self::QUEUED,
				'attempts'   => 0,
			),
			array( '%s', '%s', '%d', '%s', '%s', '%s', '%d' )
		);
		return (int) $wpdb->insert_id;
	}

	private static function finish( int $id, string $status, string $transport, string $message_id, string $error ): void {
		global $wpdb;
		if ( $id <= 0 ) {
			return;
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				'UPDATE ' . self::table() . ' SET status = %s, sent_at = %s, transport = %s, message_id = %s, last_error = %s, attempts = attempts + 1 WHERE id = %d',
				$status,
				self::SENT === $status ? gmdate( 'Y-m-d H:i:s' ) : null,
				$transport,
				$message_id,
				mb_substr( $error, 0, 2000 ),
				$id
			)
		);
	}

	/**
	 * The most recent rows, newest first.
	 *
	 * @return array<int,object>
	 */
	public static function recent( int $limit = 50, string $status = '' ): array {
		global $wpdb;
		$limit = max( 1, min( 200, $limit ) );
		if ( '' !== $status ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE status = %s ORDER BY id DESC LIMIT %d', $status, $limit ) );
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::table() . ' ORDER BY id DESC LIMIT %d', $limit ) );
	}

	/** How many messages are sitting unsent. */
	public static function stuck(): int {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::table() . ' WHERE status = %s', self::FAILED ) );
	}

	/** The rows for one order, oldest first, for the order screen. */
	public static function for_order( int $order_id ): array {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE order_id = %d ORDER BY id ASC', $order_id ) );
	}

	// ── retrying ─────────────────────────────────────────────────────────────

	/**
	 * Try the failures again.
	 *
	 * RE-RENDERED, NEVER REPLAYED. The row holds no message body (see the
	 * header), so a retry asks `Notify` to build the message again from the
	 * order as it is now. That is the right thing anyway: a proof re-sent after
	 * a correction should be the current proof.
	 *
	 * A row that has run out of attempts is left alone rather than deleted. It
	 * is the only trace that a customer was never told something, and an
	 * operator has to see it.
	 */
	public static function retry_pass(): void {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				'SELECT * FROM ' . self::table() . ' WHERE status = %s AND attempts < %d ORDER BY id ASC LIMIT 20',
				self::FAILED,
				self::MAX_ATTEMPTS
			)
		);
		foreach ( $rows as $row ) {
			self::retry( (int) $row->id );
		}
	}

	/**
	 * One retry.
	 *
	 * @return array{ok:bool,reason:string}
	 */
	public static function retry( int $id, ?string $environment = null ): array {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE id = %d', $id ) );
		if ( ! $row ) {
			return array(
				'ok'     => false,
				'reason' => 'Ce message n’existe pas.',
			);
		}
		if ( self::SENT === (string) $row->status ) {
			// Never twice. The Bible says it about webhooks and it is the same
			// rule: one event received twice must not produce two of anything.
			return array(
				'ok'     => true,
				'reason' => '',
			);
		}

		$rebuilt = Notify::rebuild( (string) $row->kind, (int) $row->order_id );
		if ( empty( $rebuilt['ok'] ) ) {
			self::finish( $id, self::FAILED, '', '', (string) $rebuilt['reason'] );
			return array(
				'ok'     => false,
				'reason' => (string) $rebuilt['reason'],
			);
		}

		$result = self::deliver( $rebuilt['message'], $environment );
		self::finish( $id, $result['ok'] ? self::SENT : self::FAILED, $result['transport'], $result['message_id'], $result['reason'] );
		return array(
			'ok'     => $result['ok'],
			'reason' => $result['reason'],
		);
	}

	public static function handle_retry(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de faire cela.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION_RETRY );

		$id     = isset( $_POST['id'] ) ? absint( wp_unslash( $_POST['id'] ) ) : 0;
		$result = self::retry( $id );
		set_transient(
			'teeshoop_mail_' . get_current_user_id(),
			$result['ok'] ? __( 'Message renvoyé.', 'teeshoop' ) : $result['reason'],
			60
		);

		$back = isset( $_POST['_wp_http_referer'] ) ? esc_url_raw( wp_unslash( $_POST['_wp_http_referer'] ) ) : admin_url();
		wp_safe_redirect( $back );
		exit;
	}

	/**
	 * Say so on every admin screen when something never reached a customer.
	 *
	 * A SILENTLY DROPPED BAT IS AN ORDER THAT STALLS FOR EVER. This is the one
	 * thing that stops that being invisible, so it is not on a screen somebody
	 * has to think of opening.
	 */
	public static function stuck_notice(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$stuck = self::stuck();
		if ( $stuck < 1 ) {
			return;
		}
		printf(
			'<div class="notice notice-error"><p><strong>Teeshoop</strong> : %s <a href="%s">%s</a></p></div>',
			esc_html(
				sprintf(
					/* translators: %d: how many messages failed to send. */
					_n(
						'%d message n’est pas parti. Un client attend peut-être un bon à tirer qu’il n’a jamais reçu.',
						'%d messages ne sont pas partis. Des clients attendent peut-être un bon à tirer qu’ils n’ont jamais reçu.',
						$stuck,
						'teeshoop'
					),
					$stuck
				)
			),
			esc_url( admin_url( 'admin.php?page=' . self::SLUG ) ),
			esc_html__( 'Voir les envois', 'teeshoop' )
		);
	}

	// ── the screen ───────────────────────────────────────────────────────────

	/** The page the stuck notice links to. */
	public const SLUG = 'teeshoop-envois';

	public static function menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Envois Teeshoop', 'teeshoop' ),
			__( 'Envois', 'teeshoop' ),
			'manage_woocommerce',
			self::SLUG,
			array( self::class, 'screen' )
		);
	}

	/**
	 * What went out, what did not, and what to do about it.
	 *
	 * FAILURES FIRST AND ALWAYS VISIBLE, because that is the only thing on this
	 * page anybody has to act on. The rest is a log, and a log is read when
	 * somebody is already asking a question.
	 */
	public static function screen(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de voir cette page.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}

		$flash = get_transient( 'teeshoop_mail_' . get_current_user_id() );
		if ( is_string( $flash ) && '' !== $flash ) {
			delete_transient( 'teeshoop_mail_' . get_current_user_id() );
			printf( '<div class="notice notice-info is-dismissible"><p>%s</p></div>', esc_html( $flash ) );
		}

		echo '<div class="wrap"><h1>' . esc_html__( 'Envois', 'teeshoop' ) . '</h1>';

		$key = self::api_key();
		printf(
			'<p class="description" style="max-width:46em">%s</p>',
			esc_html(
				'' === $key
					? 'Aucune clé Brevo n’est définie. En production, plus rien ne part et chaque message est enregistré ici comme échoué ; ailleurs, WordPress les envoie lui-même. La clé se pose dans wp-config.php : define( \'TEESHOOP_BREVO_KEY\', \'…\' );'
					: 'Les messages partent par Brevo. Un envoi refusé garde le code et le message de Brevo, et se retente depuis cette page.'
			)
		);

		$sender = self::sender();
		if ( '' === $sender['email'] ) {
			printf(
				'<div class="notice notice-warning inline"><p>%s</p></div>',
				esc_html__( 'Aucune adresse d’expédition n’est réglée. Brevo refuse d’envoyer depuis une adresse que personne n’a vérifiée dans le compte, et rien ne partira tant qu’elle manque.', 'teeshoop' )
			);
		}

		$failed = self::recent( 50, self::FAILED );
		echo '<h2>' . esc_html__( 'Ce qui n’est pas parti', 'teeshoop' ) . '</h2>';
		if ( empty( $failed ) ) {
			printf( '<p>%s</p>', esc_html__( 'Rien. Tous les messages enregistrés ont été acceptés par leur transporteur.', 'teeshoop' ) );
		} else {
			self::rows_table( $failed, true );
		}

		echo '<h2>' . esc_html__( 'Les cinquante derniers', 'teeshoop' ) . '</h2>';
		$recent = self::recent( 50 );
		if ( empty( $recent ) ) {
			printf( '<p>%s</p>', esc_html__( 'Aucun message n’a encore été envoyé depuis cette boutique.', 'teeshoop' ) );
		} else {
			self::rows_table( $recent, false );
		}

		echo '</div>';
	}

	/** @param array<int,object> $rows */
	private static function rows_table( array $rows, bool $with_retry ): void {
		echo '<table class="widefat striped"><thead><tr>';
		printf(
			'<th>%s</th><th>%s</th><th>%s</th><th>%s</th><th>%s</th><th></th>',
			esc_html__( 'Quand', 'teeshoop' ),
			esc_html__( 'Type', 'teeshoop' ),
			esc_html__( 'Commande', 'teeshoop' ),
			esc_html__( 'Destinataire', 'teeshoop' ),
			esc_html__( 'État', 'teeshoop' )
		);
		echo '</tr></thead><tbody>';

		foreach ( $rows as $row ) {
			echo '<tr>';
			printf( '<td>%s</td>', esc_html( Lifecycle::human_date( (string) $row->created_at . '+00:00' ) ) );
			printf( '<td>%s</td>', esc_html( (string) $row->kind ) );
			printf(
				'<td>%s</td>',
				(int) $row->order_id > 0
					? '<a href="' . esc_url( Lifecycle::order_url( (int) $row->order_id ) ) . '">' . (int) $row->order_id . '</a>'
					: '&mdash;'
			);
			printf( '<td>%s</td>', esc_html( (string) $row->recipient ) );
			printf(
				'<td>%s%s</td>',
				esc_html( self::state_label( (string) $row->status, (string) $row->transport ) ),
				'' !== (string) $row->last_error
					? '<br><span class="description">' . esc_html( (string) $row->last_error ) . '</span>'
					: ''
			);
			echo '<td>';
			if ( $with_retry && self::SENT !== (string) $row->status ) {
				echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
				wp_nonce_field( self::ACTION_RETRY );
				printf( '<input type="hidden" name="action" value="%s">', esc_attr( self::ACTION_RETRY ) );
				printf( '<input type="hidden" name="id" value="%d">', (int) $row->id );
				printf( '<button type="submit" class="button button-small">%s</button>', esc_html__( 'Réessayer', 'teeshoop' ) );
				echo '</form>';
			}
			echo '</td></tr>';
		}
		echo '</tbody></table>';
	}

	private static function state_label( string $status, string $transport ): string {
		if ( self::SENT === $status ) {
			return 'wp_mail' === $transport
				/* translators: the development transport, which is not Brevo. */
				? __( 'Parti par WordPress (pas par Brevo)', 'teeshoop' )
				: __( 'Parti', 'teeshoop' );
		}
		if ( self::FAILED === $status ) {
			return __( 'Échec', 'teeshoop' );
		}
		return __( 'En attente', 'teeshoop' );
	}
}
