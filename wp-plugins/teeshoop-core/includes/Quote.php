<?php
/**
 * The devis: a request that becomes a record with a state.
 *
 * WHY A RECORD AND NOT AN EMAIL. An email is lost in an inbox, has no state, and
 * cannot be counted. The Bible is emphatic about this for the whole order flow
 * (chapitre 2, « Chaque cas doit avoir une procédure, un responsable et un
 * statut, pas un simple échange WhatsApp ») and it is just as true of the first
 * contact. So the submission writes a post, the email is a notification about
 * it, and losing the email loses nothing.
 *
 * WHAT THIS IS NOT. Not a CRM. Bible chapitre 2 lists twenty-five statuses, a
 * relance cadence at J+1/J+3/J+5/J+10, an open-tracking status
 * (« devis consulté »), a per-file message thread, eleven KPIs and a commercial
 * pipeline screen. All of that is the CRM the brief puts in its own chapter and
 * the roadmap does not schedule. Five states cover the life of a request that
 * has not yet become an order; the quote DOCUMENT, its versions, its acceptance
 * token and the BAT are session 06, when there is a payment to attach them to.
 *
 * TWO PLACES THE BIBLE IS NOT FOLLOWED, deliberately:
 *
 *   It lists « commercial et commission estimée » among the mandatory contents
 *   of a devis. Read literally that puts our commission on a document a customer
 *   receives, which is our cost structure. Nothing here stores or renders one,
 *   and scripts/php-guard.mjs now carries the words themselves as needles, so a
 *   template that started to would fail the build rather than ship.
 *
 *   It gives no validity period for a quote, anywhere in eight documents, while
 *   listing « validité » as a mandatory field. In France a devis is a firm offer
 *   for the period it states, so the period is not a detail. It is question 38
 *   of QUESTIONS-ASSOCIE.md and no number is printed on anything until it comes
 *   back.
 *
 * THE FORM IS OPEN, because a prospect cannot authenticate. It is kept usable
 * and non-abusable the same way the Worker's upload routes are: bounded input,
 * a signed and short-lived form stamp, a honeypot, and a rate limit. Never
 * through obscurity.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

/*
 * THE TEST ESCAPE, LIKE EVERY OTHER FILE IN THIS DIRECTORY. It was missing
 * here alone, and the consequence was not a missing test: a pure test that
 * required this file called `exit` at load, PHP ran the shutdown handlers, and
 * `tests/run.php` ended with NO summary line and status 0. A green run that had
 * silently stopped a third of the way through. Nothing in this file touches
 * WordPress at load time, which is why the guard can carry it: the hypotheses
 * guard already `require_once`s every file here in a bare PHP process.
 */
defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Quote {

	public const POST_TYPE = 'teeshoop_devis';

	/** Where a request is in its short life. Not the order lifecycle. */
	public const STATUSES = array(
		'ts-recu'    => 'Reçue',
		'ts-encours' => 'En cours de chiffrage',
		'ts-envoye'  => 'Devis envoyé',
		'ts-accepte' => 'Accepté',
		'ts-refuse'  => 'Sans suite',
	);

	/** The form action, and the only way in. */
	public const ACTION = 'teeshoop_devis';

	/** How long a rendered form stays acceptable, seconds. */
	private const STAMP_TTL = 7200;

	/** A form returned faster than this was not filled in by a person. */
	private const MIN_FILL_SECONDS = 3;

	/** Submissions accepted from one address per hour. */
	private const RATE_LIMIT = 5;

	/**
	 * How long a request is kept after the last exchange, in days.
	 *
	 * Three years is the CNIL's standard recommendation for prospect data, and
	 * it is what the form tells the prospect. It is a NUMBER WITH A MECHANISM
	 * behind it: `purge()` runs daily and deletes what is past it. A retention
	 * period announced under a form and enforced by nothing is a statement to a
	 * data subject that is not true, which is the part that matters.
	 *
	 * Question 40 of QUESTIONS-ASSOCIE.md asks the associate to confirm it.
	 *
	 * PUBLIC SINCE SESSION 12, because the conditions of sale and the privacy
	 * policy both state this duration to the person it is about, and a number a
	 * customer reads must not be typed a second time in the document that reads
	 * it. `Terms::live_values()` and `Privacy::register()` take it from here.
	 * It was private, and the register's own guard reached it by reflection,
	 * which is a sign that the visibility was wrong rather than that the reader
	 * was clever.
	 */
	public const KEEP_DAYS = 1095;

	/** The daily purge. */
	private const CRON = 'teeshoop_purge_devis';

	public static function init(): void {
		add_action( 'init', array( self::class, 'register' ) );
		add_action( 'admin_post_nopriv_' . self::ACTION, array( self::class, 'submit' ) );
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'submit' ) );
		add_filter( 'manage_' . self::POST_TYPE . '_posts_columns', array( self::class, 'columns' ) );
		add_action( 'manage_' . self::POST_TYPE . '_posts_custom_column', array( self::class, 'column' ), 10, 2 );
		add_action( 'add_meta_boxes', array( self::class, 'meta_box' ) );
		add_action( 'post_submitbox_misc_actions', array( self::class, 'status_control' ) );
		add_action( 'save_post_' . self::POST_TYPE, array( self::class, 'save_status' ), 10, 2 );
		add_action( 'admin_post_' . self::ACTION_ISSUE, array( self::class, 'handle_issue' ) );

		/*
		 * THE RETENTION IS A MECHANISM, NOT A SENTENCE.
		 *
		 * The form tells the prospect their details are erased three years after
		 * the last exchange. Until this ran, nothing deleted anything: the
		 * promise under the submit button was simply false, and an erasure
		 * request through WordPress's own privacy tools would have reported that
		 * we held nothing while thirteen meta rows sat on a post.
		 */
		add_action( self::CRON, array( self::class, 'purge' ) );
		add_action( 'init', array( self::class, 'schedule' ) );
		add_filter( 'wp_privacy_personal_data_exporters', array( self::class, 'register_exporter' ) );
		add_filter( 'wp_privacy_personal_data_erasers', array( self::class, 'register_eraser' ) );
	}

	public static function schedule(): void {
		if ( ! wp_next_scheduled( self::CRON ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::CRON );
		}
	}

	/**
	 * Delete requests nobody has touched for the retention period.
	 *
	 * Keyed on `post_modified`, which is the last time anyone changed the state
	 * or the notes, so "our last exchange" is what it measures. Bounded per run
	 * because this is shared hosting and a cron that times out half way through
	 * deletes half a batch and never records that it did.
	 */
	public static function purge(): void {
		$cutoff = gmdate( 'Y-m-d H:i:s', time() - self::KEEP_DAYS * DAY_IN_SECONDS );

		$stale = get_posts(
			array(
				'post_type'      => self::POST_TYPE,
				// The bin included: see `by_email()`. A request somebody binned
				// is still a request we hold about a person, and it was escaping
				// this sweep as well as the eraser.
				'post_status'    => array_merge( array_keys( self::STATUSES ), array( 'trash' ) ),
				'posts_per_page' => 200,
				'fields'         => 'ids',
				'date_query'     => array(
					array(
						'column' => 'post_modified_gmt',
						'before' => $cutoff,
					),
				),
			)
		);

		foreach ( $stale as $id ) {
			wp_delete_post( (int) $id, true );
		}
	}

	/** WordPress's own export tool must find these rows. */
	public static function register_exporter( array $exporters ): array {
		$exporters['teeshoop-devis'] = array(
			'exporter_friendly_name' => __( 'Demandes de devis Teeshoop', 'teeshoop' ),
			'callback'               => array( self::class, 'export_personal_data' ),
		);
		return $exporters;
	}

	/** And its erase tool must actually erase them. */
	public static function register_eraser( array $erasers ): array {
		$erasers['teeshoop-devis'] = array(
			'eraser_friendly_name' => __( 'Demandes de devis Teeshoop', 'teeshoop' ),
			'callback'             => array( self::class, 'erase_personal_data' ),
		);
		return $erasers;
	}

	/**
	 * The requests belonging to one address.
	 *
	 * THE BIN COUNTS, AND IT USED NOT TO. This filtered on `STATUSES` alone, and
	 * `trash` is not one of them. The post type has `show_ui`, so a shop manager
	 * moving a request to the bin is one click, and from that click the row was
	 * invisible to the exporter, to the eraser AND to `purge()` at the same time:
	 * thirteen meta rows about a named person, kept for ever, past the three
	 * years the form promises them. A subject access request would have answered
	 * « nous n'avons rien ».
	 *
	 * @return array<string,mixed>
	 */
	private static function by_email( string $email, int $page ): array {
		return get_posts(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => array_merge( array_keys( self::STATUSES ), array( 'trash' ) ),
				// The same page size `Privacy::more_to_do()` measures « a full
				// page » against; two numbers here would make that rule wrong.
				'posts_per_page' => Privacy::PAGE,
				'paged'          => max( 1, $page ),
				'fields'         => 'ids',
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- a privacy request, run by hand, not on a page load.
				'meta_query'     => array(
					array(
						'key'   => '_ts_email',
						'value' => $email,
					),
				),
			)
		);
	}

	public static function export_personal_data( string $email, int $page = 1 ): array {
		$fields = array(
			'_ts_societe'   => __( 'Société', 'teeshoop' ),
			'_ts_contact'   => __( 'Contact', 'teeshoop' ),
			'_ts_email'     => __( 'E-mail', 'teeshoop' ),
			'_ts_telephone' => __( 'Téléphone', 'teeshoop' ),
			'_ts_siret'     => __( 'SIRET', 'teeshoop' ),
			'_ts_message'   => __( 'Message', 'teeshoop' ),
			'_ts_echeance'  => __( 'Échéance souhaitée', 'teeshoop' ),
			/*
			 * THE ATTRIBUTION IS PERSONAL DATA TOO, and the export is where
			 * that gets forgotten. It was collected with this person's consent,
			 * it is attached to their name and their email, and a subject
			 * access request that answered with the form fields alone would be
			 * a report of only the part we were comfortable showing.
			 */
			'_ts_page'      => __( 'Page depuis laquelle la demande a été envoyée', 'teeshoop' ),
			'_ts_src_page'  => __( 'Page d’arrivée sur le site', 'teeshoop' ),
			'_ts_src_ref'   => __( 'Site référent', 'teeshoop' ),
			'_ts_src_camp'  => __( 'Campagne', 'teeshoop' ),

			/*
			 * AND SO IS WHAT THEY ASKED FOR, which this list was missing.
			 *
			 * Seven fields were written by `submit()` and exported by nothing:
			 * the article, the quantity, the faces, the size grid, the estimate
			 * we computed and why, and the identifier of the creation they
			 * composed. Article 15 asks for a copy of ALL the personal data
			 * undergoing processing, and « la demande » without what was demanded
			 * is the half we were comfortable showing.
			 */
			'_ts_product_id'   => __( 'Article concerné', 'teeshoop' ),
			'_ts_qty'          => __( 'Quantité demandée', 'teeshoop' ),
			'_ts_faces'        => __( 'Faces à imprimer', 'teeshoop' ),
			'_ts_tailles'      => __( 'Répartition des tailles', 'teeshoop' ),
			'_ts_estimate_ht'  => __( 'Estimation communiquée, hors taxes', 'teeshoop' ),
			'_ts_estimate_why' => __( 'Comment cette estimation a été obtenue', 'teeshoop' ),
			'_ts_design_id'    => __( 'Création jointe', 'teeshoop' ),
		);

		$ids  = self::by_email( $email, $page );
		$data = array();

		foreach ( $ids as $id ) {
			$rows = array();
			foreach ( $fields as $key => $label ) {
				$value = (string) get_post_meta( (int) $id, $key, true );
				if ( '' !== $value ) {
					$rows[] = array(
						'name'  => $label,
						'value' => $value,
					);
				}
			}
			/*
			 * EVERY DEVIS ISSUED TO THIS PERSON, which is the substantive part.
			 * `_ts_versions` holds each document we sent them: its number, its
			 * date and its lines. A person asking what we hold about them is
			 * asking for those, not only for the form they filled in.
			 */
			$versions = get_post_meta( (int) $id, '_ts_versions', true );
			if ( is_array( $versions ) ) {
				foreach ( $versions as $i => $version ) {
					if ( ! is_array( $version ) ) {
						continue;
					}
					$rows[] = array(
						'name'  => sprintf(
							/* translators: %d: the index of the quote document, from 1. */
							__( 'Devis émis n°%d', 'teeshoop' ),
							(int) $i + 1
						),
						'value' => trim(
							(string) ( $version['numero'] ?? '' ) . ' ' . (string) ( $version['date'] ?? '' )
						),
					);
				}
			}

			$data[] = array(
				'group_id'    => 'teeshoop-devis',
				'group_label' => __( 'Demandes de devis', 'teeshoop' ),
				'item_id'     => 'devis-' . (int) $id,
				'data'        => $rows,
			);
		}

		return array(
			'data' => $data,
			'done' => count( $ids ) < Privacy::PAGE,
		);
	}

	/**
	 * Delete the requests of one address.
	 *
	 * PAGE 1 EVERY TIME, WHATEVER WORDPRESS ASKS FOR, and that is a fix.
	 *
	 * WordPress calls an eraser with page 1, then page 2, until `done`. This read
	 * `by_email( $email, $page )`, which is an OFFSET: page 1 deleted the first
	 * twenty, and page 2 then offset twenty rows into a set from which those
	 * twenty had already gone. Items 21 to 40 were skipped for ever, and the run
	 * reported `done` as soon as a page came back short. It bites exactly the
	 * person most likely to ask: a repeat business prospect with more than twenty
	 * quote requests.
	 *
	 * The exporter's identical pagination is CORRECT and is deliberately left
	 * alone: it mutates nothing, so its offset walks a stable set. Sharing the
	 * pagination between the two would have been the obvious tidy-up and would
	 * have been wrong.
	 */
	public static function erase_personal_data( string $email, int $page = 1 ): array {
		$ids      = self::by_email( $email, 1 );
		$messages = array();
		$removed  = 0;

		foreach ( $ids as $id ) {
			/*
			 * THE CREATION FIRST, because it is the only part that lives on
			 * somebody else's machine and the only part that can fail. The post
			 * meta IS the index: delete the post and then discover the Worker is
			 * unreachable, and nothing can ever find that artwork again.
			 */
			$design = (string) get_post_meta( (int) $id, '_ts_design_id', true );
			if ( '' !== $design ) {
				$r = Privacy::delete_design( $design );
				if ( ! $r['ok'] ) {
					// Same reason as `Privacy::erase_order`: the request is held
					// open rather than closed as done, so nobody is told their
					// data was erased while a file of theirs is still online.
					Privacy::hold_request_open();
					$messages[] = sprintf(
						/* translators: 1: design identifier, 2: the reason it failed. */
						__( 'La création %1$s jointe à une demande de devis n’a pas pu être supprimée de son hébergement (%2$s). La demande reste ouverte.', 'teeshoop' ),
						$design,
						$r['reason']
					);
					continue;
				}
			}

			// Deleted outright, not anonymised. A quote request that never became
			// an order carries no fiscal obligation to keep it, so there is
			// nothing to weigh against the erasure.
			wp_delete_post( (int) $id, true );
			++$removed;
		}

		/*
		 * AND IT STOPS WHEN IT STOPS MAKING PROGRESS, which `count($ids) < 20`
		 * did not. This eraser re-reads page 1 every time (see above), so the
		 * window only shrinks when something is actually deleted. A prospect with
		 * twenty or more requests, each carrying a design the Worker cannot
		 * remove, made every pass return the same twenty with `done` false, and
		 * WordPress's own privacy-tools.js calls the next page with no cap and no
		 * back-off. Measured on the mirror with twenty-one seeded requests: four
		 * consecutive calls, items_removed false, done false, for ever.
		 *
		 * `Privacy::more_to_do` is that rule, and it is called rather than
		 * copied: two erasers deciding when to stop in two slightly different
		 * ways is how one of them keeps the bug the other lost.
		 */
		return array(
			'items_removed'  => $removed > 0,
			'items_retained' => count( $messages ) > 0,
			'messages'       => $messages,
			'done'           => ! Privacy::more_to_do( $removed > 0, count( $ids ) ),
		);
	}

	public static function register(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'          => array(
					'name'          => __( 'Demandes de devis', 'teeshoop' ),
					'singular_name' => __( 'Demande de devis', 'teeshoop' ),
					'menu_name'     => __( 'Devis', 'teeshoop' ),
					'search_items'  => __( 'Rechercher une demande', 'teeshoop' ),
					'not_found'     => __( 'Aucune demande pour le moment.', 'teeshoop' ),
				),
				/*
				 * NOT public, and every flag that follows from that is spelled
				 * out rather than inherited. A quote request holds a company
				 * name, a contact, an email and a phone number; `public => true`
				 * would put it on a URL, in the site's search results and in the
				 * sitemap. Anything reachable by URL is public.
				 */
				'public'          => false,
				'publicly_queryable' => false,
				'exclude_from_search' => true,
				'has_archive'     => false,
				'rewrite'         => false,
				'show_ui'         => true,
				'show_in_menu'    => true,
				'show_in_rest'    => false,
				'menu_icon'       => 'dashicons-media-spreadsheet',
				'menu_position'   => 56,
				'supports'        => array( 'title' ),
				'capability_type' => 'shop_order',
				'map_meta_cap'    => true,
				'capabilities'    => array( 'create_posts' => 'do_not_allow' ),
			)
		);

		foreach ( self::STATUSES as $slug => $label ) {
			register_post_status(
				$slug,
				array(
					'label'                     => $label,
					'public'                    => false,
					'internal'                  => false,
					'exclude_from_search'       => true,
					'show_in_admin_all_list'    => true,
					'show_in_admin_status_list' => true,
					/* translators: %s: number of quote requests in this state. */
					'label_count'               => _n_noop( $label . ' (%s)', $label . ' (%s)', 'teeshoop' ),
				)
			);
		}
	}

	// -----------------------------------------------------------------------
	// Submission
	// -----------------------------------------------------------------------

	/**
	 * A signature over the moment the form was rendered.
	 *
	 * Not a nonce. A WordPress nonce on an anonymous, cacheable product page is
	 * a gate that fails for the wrong reason: the page is served from a cache,
	 * the nonce inside it is stale, and a genuine customer is told their session
	 * expired. This stamp is stateless, so a cached page carries a stamp that is
	 * still valid until it ages out, and a bot that POSTs without ever fetching
	 * the form has nothing to send.
	 */
	/**
	 * Why a request carries no self-serve estimate, in words an operator can act
	 * on.
	 *
	 * TWO REASONS, TWO SENTENCES. A run past `max_qty` is genuinely outside the
	 * public grid and wants a hand chiffrage; a request that names no product,
	 * which is every request the standalone /devis/ page produces, has nothing to
	 * price and wants the operator to pick the garment first. Both stored a zero,
	 * and both screens said the quantity was too large, which for a 240-piece
	 * request on a grid that runs to ten thousand is simply false.
	 *
	 * An empty reason is a record written before this was stored, and it gets the
	 * neutral sentence rather than either guess.
	 */
	private static function no_estimate( string $why ): string {
		switch ( $why ) {
			case 'sans_article':
				return __( 'aucune : la demande ne désigne pas d’article', 'teeshoop' );
			case 'hors_grille':
				return __( 'aucune : cette quantité dépasse la grille publique', 'teeshoop' );
			default:
				return __( 'aucune', 'teeshoop' );
		}
	}

	public static function stamp(): string {
		$now = (string) time();
		return $now . '.' . hash_hmac( 'sha256', $now, wp_salt( 'teeshoop_devis' ) );
	}

	/** @return array{ok:bool,reason:string} */
	private static function check_stamp( string $stamp ): array {
		$parts = explode( '.', $stamp, 2 );
		if ( 2 !== count( $parts ) || ! ctype_digit( $parts[0] ) ) {
			return array(
				'ok'     => false,
				'reason' => 'stamp',
			);
		}

		$issued   = (int) $parts[0];
		$expected = hash_hmac( 'sha256', $parts[0], wp_salt( 'teeshoop_devis' ) );
		if ( ! hash_equals( $expected, $parts[1] ) ) {
			return array(
				'ok'     => false,
				'reason' => 'stamp',
			);
		}

		$age = time() - $issued;
		if ( $age < 0 || $age > self::STAMP_TTL ) {
			return array(
				'ok'     => false,
				'reason' => 'expire',
			);
		}
		if ( $age < self::MIN_FILL_SECONDS ) {
			return array(
				'ok'     => false,
				'reason' => 'trop_rapide',
			);
		}

		return array(
			'ok'     => true,
			'reason' => '',
		);
	}

	/**
	 * A per-address counter that does not store an address.
	 *
	 * The IP is hashed with a site salt and kept only as a transient key for an
	 * hour, so what survives is a count and not a visitor. Storing the address
	 * itself on the request would be personal data we have no need for once the
	 * hour is over, and data we do not hold is data we cannot leak.
	 */
	private static function rate_limited(): bool {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( (string) $_SERVER['REMOTE_ADDR'] ) ) : '';
		if ( '' === $ip ) {
			return false;
		}
		$key   = 'ts_devis_' . substr( hash_hmac( 'sha256', $ip, wp_salt( 'teeshoop_devis' ) ), 0, 22 );
		$count = (int) get_transient( $key );
		if ( $count >= self::RATE_LIMIT ) {
			return true;
		}
		set_transient( $key, $count + 1, HOUR_IN_SECONDS );
		return false;
	}

	/** Handle the POST, write the record, notify, and redirect. */
	/**
	 * Where the prospect is sent back to, whether it worked or not.
	 *
	 * The form used to be on ONE page, the product page, so the product's own
	 * permalink was the answer. Session 09 puts the same form on a standalone
	 * `/devis/` page, where `product_id` is 0 and `get_permalink( 0 )` is false:
	 * a buyer who mistyped their e-mail was bounced to the homepage, with the
	 * error message on a page that does not carry the form.  So the page says
	 * where it is.
	 *
	 * IT IS A POSTED FIELD, therefore untrusted, therefore validated. Sending a
	 * visitor to an arbitrary URL on the strength of a form field is an open
	 * redirect, and an open redirect on a page whose address bar says Teeshoop
	 * is a phishing kit. `wp_validate_redirect` returns the empty fallback for
	 * anything not on this host, and the product permalink takes over.
	 *
	 * @param array $post       The unslashed submission.
	 * @param int   $product_id The product the form declared, 0 when standalone.
	 */
	private static function return_url( array $post, int $product_id ): string {
		$asked = isset( $post['retour'] ) ? esc_url_raw( (string) $post['retour'] ) : '';
		$safe  = '' !== $asked ? wp_validate_redirect( $asked, '' ) : '';
		if ( '' !== $safe ) {
			return $safe;
		}
		return get_permalink( $product_id ) ?: home_url( '/' );
	}

	public static function submit(): void {
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- an open public form; see the stamp, honeypot and rate limit above.
		$post = wp_unslash( $_POST );
		// phpcs:enable WordPress.Security.NonceVerification.Missing

		$product_id = (int) ( $post['product_id'] ?? 0 );
		$back       = self::return_url( $post, $product_id );

		// The honeypot is a real, labelled field hidden from sight, so a bot
		// that fills every input gives itself away and a screen reader is told
		// to leave it alone.
		if ( '' !== trim( (string) ( $post['site_web'] ?? '' ) ) ) {
			self::back( $back, 'erreur', 'robot', $post );
		}

		$stamp = self::check_stamp( (string) ( $post['stamp'] ?? '' ) );
		if ( ! $stamp['ok'] ) {
			self::back( $back, 'erreur', $stamp['reason'], $post );
		}

		$email = sanitize_email( (string) ( $post['email'] ?? '' ) );
		$contact = self::text( $post['contact'] ?? '', 120 );
		$company = self::text( $post['societe'] ?? '', 160 );

		/*
		 * VALIDATION FIRST, THE COUNTER SECOND.
		 *
		 * The rate limiter used to run before the e-mail was checked, so five
		 * typos spent the hour's whole allowance and locked the buyer out. And
		 * `<input type="email">` accepts `contact@mairie` while `is_email` does
		 * not, so a real French address without a dot in the domain is a typo
		 * the browser waves through. A limiter is there to stop a flood, not to
		 * punish somebody who cannot get past our own form.
		 */
		if ( ! is_email( $email ) ) {
			self::back( $back, 'erreur', 'email', $post );
		}
		if ( '' === $contact ) {
			self::back( $back, 'erreur', 'contact', $post );
		}

		if ( self::rate_limited() ) {
			self::back( $back, 'erreur', 'trop_de_demandes', $post );
		}

		$garment = Product::garment_of( $product_id );
		$config  = Settings::pricing();
		$sizes   = ProductPage::size_ids( $garment );

		$grid = array();
		foreach ( (array) ( $post['tailles'] ?? array() ) as $size => $count ) {
			$size  = strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', (string) $size ) ?? '' );
			$count = (int) $count;
			if ( $count > 0 && in_array( $size, $sizes, true ) ) {
				$grid[ $size ] = min( $count, 1000000 );
			}
		}

		$qty = ! empty( $grid ) ? (int) array_sum( $grid ) : max( 1, (int) ( $post['qte'] ?? 1 ) );
		// A quote request is where a quantity larger than the shop's own cap
		// belongs, so it is bounded only against nonsense.
		$qty   = min( $qty, 1000000 );
		$faces = max( 1, min( (int) ( $post['faces'] ?? 1 ), Garments::printable_sides_count( $garment ) ) );

		/*
		 * The self-serve figure, frozen onto the record.
		 *
		 * Not a price offered to anyone: it is what this page would have quoted
		 * at that quantity, so whoever picks the request up starts from the same
		 * number the customer just read instead of from a blank sheet. It is
		 * computed HERE, on the server, from the same Pricing as everything
		 * else, and never from anything the form posted.
		 */
		$estimate_ht = 0;
		/*
		 * NOTHING IS STORED FOR A RUN THE PUBLIC GRID DOES NOT COVER.
		 *
		 * The figure used to be computed at `min( $qty, max_qty )` and stored
		 * beside the real quantity, so a request for 30 000 pieces carried
		 * "94 200,00 EUR HT", which is the total for ten thousand: an operator
		 * reading the list saw a per-piece rate three times too low, on the
		 * screen built to save them from starting at zero. A blank with a reason
		 * is worth more than a number that means something else.
		 */
		if ( '' !== $garment && $qty <= (int) $config['max_qty'] ) {
			try {
				$quote       = Pricing::quote(
					array(
						'garment' => $garment,
						'qty'     => $qty,
						'sides'   => Pricing::standard_sides( $faces ),
					),
					$config
				);
				$estimate_ht = (int) $quote['total_ht'];
			} catch ( \InvalidArgumentException $e ) {
				$estimate_ht = 0;
			}
		}

		$source = class_exists( '\\Teeshoop\\Core\\Consent' )
			? Consent::source()
			: array(
				'page'     => '',
				'referent' => '',
				'campagne' => '',
			);

		$post_id = wp_insert_post(
			array(
				'post_type'   => self::POST_TYPE,
				'post_status' => 'ts-recu',
				'post_title'  => self::title( $company, $contact, $qty ),
			),
			true
		);

		if ( is_wp_error( $post_id ) ) {
			self::back( $back, 'erreur', 'enregistrement', $post );
		}

		$meta = array(
			'_ts_societe'     => $company,
			'_ts_contact'     => $contact,
			'_ts_email'       => $email,
			'_ts_telephone'   => self::text( $post['telephone'] ?? '', 40 ),
			'_ts_siret'       => preg_replace( '/[^0-9]/', '', (string) ( $post['siret'] ?? '' ) ) ?? '',
			'_ts_product_id'  => $product_id,
			'_ts_garment'     => $garment,
			'_ts_qty'         => $qty,
			'_ts_faces'       => $faces,
			'_ts_tailles'     => wp_json_encode( $grid ),
			'_ts_echeance'    => self::date( (string) ( $post['echeance'] ?? '' ) ),
			'_ts_message'     => self::text( $post['message'] ?? '', 4000 ),
			'_ts_estimate_ht' => $estimate_ht,
			/*
			 * WHY IT IS ZERO, because there are now two reasons and they read
			 * differently to an operator. A run past `max_qty` is out of the
			 * public grid; a request that names no product (the standalone
			 * /devis/ page posts `product_id = 0`) has no garment to price at
			 * all. Both stored 0 and both screens printed « la quantité dépasse
			 * la grille publique », so a 240-piece request was reported as being
			 * over a grid that runs to ten thousand.
			 */
			'_ts_estimate_why' => $estimate_ht > 0 ? '' : ( '' === $garment ? 'sans_article' : 'hors_grille' ),
			'_ts_design_id'   => Design::valid_id( (string) ( $post['design_id'] ?? '' ) ) ? (string) $post['design_id'] : '',

			/*
			 * WHERE THE REQUEST CAME FROM, in two layers with two legal bases.
			 *
			 * `_ts_page` is the PATH of the page the form was posted from, and
			 * it needs no permission because nothing is stored on the visitor's
			 * machine to obtain it. It answers the question a landing page
			 * exists to answer: did anyone fill the form on it. The path only,
			 * never the query string, because `/?s=commande pour dupont sarl`
			 * copied onto a prospect record is personal data nobody meant to
			 * collect.
			 *
			 * IT IS UNTRUSTED, AND THIS COMMENT USED TO SAY OTHERWISE. It comes
			 * from `$back`, which comes from `$_POST`, whose own docblock says
			 * so. A single anonymous request put a 4 016-character path on a
			 * record and therefore a 4 016-character row on the screen where the
			 * associate decides which pages to fund. Bounded like every other
			 * posted field on this form. It is escaped where it is printed, so
			 * this is a legibility bound rather than an injection one.
			 *
			 * The other three come from `Consent::source()`, which returns three
			 * empty strings unless the visitor allowed attribution. Carrying a
			 * first landing page across several pages means writing an
			 * identifier on a terminal, and article 82 covers that whether it is
			 * a cookie or anything else. So the funnel reports what it can
			 * always know, and reports the rest as « non renseigné » rather than
			 * pretending the visit had no origin.
			 */
			'_ts_page'        => mb_substr( (string) wp_parse_url( $back, PHP_URL_PATH ), 0, 120 ),
			'_ts_src_page'    => $source['page'],
			'_ts_src_ref'     => $source['referent'],
			'_ts_src_camp'    => $source['campagne'],
		);
		foreach ( $meta as $key => $value ) {
			update_post_meta( $post_id, $key, $value );
		}

		self::notify( (int) $post_id, $meta );

		self::back( $back, 'ok', '' );
	}

	private static function text( mixed $raw, int $max ): string {
		$value = sanitize_textarea_field( (string) $raw );
		return mb_substr( trim( $value ), 0, $max );
	}

	/** A date the customer chose, or '', never today as a fallback. */
	private static function date( string $raw ): string {
		$parsed = \DateTimeImmutable::createFromFormat( '!Y-m-d', $raw );
		return ( $parsed && $parsed->format( 'Y-m-d' ) === $raw ) ? $raw : '';
	}

	private static function title( string $company, string $contact, int $qty ): string {
		$who = '' !== $company ? $company : $contact;
		return sprintf(
			/* translators: 1: company or contact name, 2: quantity. */
			__( '%1$s, %2$d pièces', 'teeshoop' ),
			$who,
			$qty
		);
	}

	/**
	 * Post/redirect/get, always, including on failure.
	 *
	 * A form that leaves the browser on a POST result gives a customer a
	 * resubmit dialog on refresh, and a duplicate request is a second person
	 * chasing the same job.
	 */
	private static function back( string $url, string $result, string $reason, array $sent = array() ): void {
		$args = array( 'devis' => $result );
		if ( '' !== $reason ) {
			$args['raison'] = $reason;
		}

		/*
		 * WHAT THEY TYPED COMES BACK WITH THEM.
		 *
		 * Every failure path used to redirect to an empty form, so a stale
		 * stamp, a mistyped address or one request too many destroyed a
		 * four-thousand-character project brief. People do not retype that; they
		 * leave. The payload is stashed in a short transient rather than put on
		 * the URL, because a URL carrying a name and a phone number ends up in
		 * a browser history, a proxy log and an analytics referrer.
		 */
		if ( ! empty( $sent ) ) {
			$token = wp_generate_password( 20, false, false );
			set_transient(
				'ts_devis_back_' . $token,
				array(
					'contact'   => self::text( $sent['contact'] ?? '', 120 ),
					'societe'   => self::text( $sent['societe'] ?? '', 160 ),
					'email'     => sanitize_text_field( (string) ( $sent['email'] ?? '' ) ),
					'telephone' => self::text( $sent['telephone'] ?? '', 40 ),
					'siret'     => self::text( $sent['siret'] ?? '', 20 ),
					'qte'       => (int) ( $sent['qte'] ?? 1 ),
					'echeance'  => self::date( (string) ( $sent['echeance'] ?? '' ) ),
					'message'   => self::text( $sent['message'] ?? '', 4000 ),
				),
				30 * MINUTE_IN_SECONDS
			);
			$args['reprise'] = $token;
		}

		wp_safe_redirect( add_query_arg( $args, $url ) . '#teeshoop-devis' );
		exit;
	}

	/**
	 * The values to put back in the form after a refused submission.
	 *
	 * Read once and deleted, so a token in a shared browser history cannot be
	 * replayed to read somebody else's contact details back out.
	 */
	public static function resume(): array {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading our own one-shot token.
		$token = isset( $_GET['reprise'] ) ? sanitize_key( wp_unslash( (string) $_GET['reprise'] ) ) : '';
		if ( '' === $token ) {
			return array();
		}
		$stored = get_transient( 'ts_devis_back_' . $token );
		delete_transient( 'ts_devis_back_' . $token );
		return is_array( $stored ) ? $stored : array();
	}

	/** Where the shop is told. Falls back to the site admin, never to nowhere. */
	public static function notify_address(): string {
		$configured = Settings::get( 'quote_email' );
		return is_email( $configured ) ? $configured : (string) get_option( 'admin_email' );
	}

	/**
	 * Tell the shop, then acknowledge to the customer.
	 *
	 * Both are best-effort by design. The record is already written when this
	 * runs, so a mail server that is down delays a notification and loses no
	 * request. The reverse arrangement (mail first, record if it worked) is
	 * how quote requests disappear.
	 */
	private static function notify( int $post_id, array $meta ): void {
		$edit = admin_url( 'post.php?post=' . $post_id . '&action=edit' );

		$lines = array(
			sprintf( __( 'Société : %s', 'teeshoop' ), '' !== $meta['_ts_societe'] ? $meta['_ts_societe'] : __( 'non renseignée', 'teeshoop' ) ),
			sprintf( __( 'Contact : %s', 'teeshoop' ), $meta['_ts_contact'] ),
			sprintf( __( 'E-mail : %s', 'teeshoop' ), $meta['_ts_email'] ),
			sprintf( __( 'Téléphone : %s', 'teeshoop' ), '' !== $meta['_ts_telephone'] ? $meta['_ts_telephone'] : __( 'non renseigné', 'teeshoop' ) ),
			sprintf( __( 'Quantité : %d', 'teeshoop' ), $meta['_ts_qty'] ),
			sprintf( __( 'Faces imprimées : %d', 'teeshoop' ), $meta['_ts_faces'] ),
			(int) $meta['_ts_estimate_ht'] > 0
				? sprintf( __( 'Estimation libre-service : %s HT', 'teeshoop' ), Money::format( (int) $meta['_ts_estimate_ht'] ) )
				: sprintf(
					/* translators: %s: why there is no self-serve estimate. */
					__( 'Estimation libre-service : %s', 'teeshoop' ),
					self::no_estimate( (string) ( $meta['_ts_estimate_why'] ?? '' ) )
				),
			'',
			$edit,
		);

		wp_mail(
			self::notify_address(),
			sprintf(
				/* translators: %s: company or contact name. */
				__( '[Teeshoop] Demande de devis : %s', 'teeshoop' ),
				'' !== $meta['_ts_societe'] ? $meta['_ts_societe'] : $meta['_ts_contact']
			),
			implode( "\n", $lines )
		);

		wp_mail(
			(string) $meta['_ts_email'],
			__( 'Votre demande de devis Teeshoop', 'teeshoop' ),
			implode(
				"\n",
				array(
					sprintf( __( 'Bonjour %s,', 'teeshoop' ), $meta['_ts_contact'] ),
					'',
					__( 'Nous avons bien reçu votre demande. Un chiffrage vous parvient par retour, avec le délai de fabrication et les conditions de paiement.', 'teeshoop' ),
					'',
					sprintf( __( 'Quantité indiquée : %d pièces.', 'teeshoop' ), $meta['_ts_qty'] ),
					'',
					__( 'Si vous devez ajouter quelque chose, répondez simplement à ce message.', 'teeshoop' ),
					'',
					get_bloginfo( 'name' ),
				)
			)
		);
	}

	// -----------------------------------------------------------------------
	// Admin
	// -----------------------------------------------------------------------

	public static function columns( array $columns ): array {
		return array(
			'cb'          => $columns['cb'] ?? '',
			'title'       => __( 'Demande', 'teeshoop' ),
			'ts_status'   => __( 'État', 'teeshoop' ),
			'ts_contact'  => __( 'Contact', 'teeshoop' ),
			'ts_qty'      => __( 'Quantité', 'teeshoop' ),
			'ts_estimate' => __( 'Estimation HT', 'teeshoop' ),
			'date'        => __( 'Reçue le', 'teeshoop' ),
		);
	}

	public static function column( string $column, int $post_id ): void {
		switch ( $column ) {
			case 'ts_status':
				$status = (string) get_post_status( $post_id );
				echo esc_html( self::STATUSES[ $status ] ?? $status );
				break;
			case 'ts_contact':
				printf(
					'%s<br><a href="mailto:%s">%s</a>',
					esc_html( (string) get_post_meta( $post_id, '_ts_contact', true ) ),
					esc_attr( (string) get_post_meta( $post_id, '_ts_email', true ) ),
					esc_html( (string) get_post_meta( $post_id, '_ts_email', true ) )
				);
				break;
			case 'ts_qty':
				echo esc_html( Money::number( (float) get_post_meta( $post_id, '_ts_qty', true ) ) );
				break;
			case 'ts_estimate':
				$estimate = (int) get_post_meta( $post_id, '_ts_estimate_ht', true );
				echo esc_html(
					$estimate > 0
						? Money::format( $estimate )
						: self::no_estimate( (string) get_post_meta( $post_id, '_ts_estimate_why', true ) )
				);
				break;
		}
	}

	public static function meta_box(): void {
		add_meta_box(
			'teeshoop-devis',
			__( 'La demande', 'teeshoop' ),
			array( self::class, 'render_meta_box' ),
			self::POST_TYPE,
			'normal',
			'high'
		);
	}

	public static function render_meta_box( \WP_Post $post ): void {
		$grid = json_decode( (string) get_post_meta( $post->ID, '_ts_tailles', true ), true );
		$rows = array(
			__( 'Société', 'teeshoop' )     => (string) get_post_meta( $post->ID, '_ts_societe', true ),
			__( 'Contact', 'teeshoop' )     => (string) get_post_meta( $post->ID, '_ts_contact', true ),
			__( 'E-mail', 'teeshoop' )      => (string) get_post_meta( $post->ID, '_ts_email', true ),
			__( 'Téléphone', 'teeshoop' )   => (string) get_post_meta( $post->ID, '_ts_telephone', true ),
			__( 'SIRET', 'teeshoop' )       => (string) get_post_meta( $post->ID, '_ts_siret', true ),
			__( 'Quantité', 'teeshoop' )    => Money::number( (float) get_post_meta( $post->ID, '_ts_qty', true ) ),
			__( 'Faces', 'teeshoop' )       => (string) (int) get_post_meta( $post->ID, '_ts_faces', true ),
			__( 'Tailles', 'teeshoop' )     => is_array( $grid ) && ! empty( $grid )
				? implode( ' · ', array_map( static fn( $n, $s ): string => $n . ' × ' . $s, $grid, array_keys( $grid ) ) )
				: '',
			__( 'Échéance', 'teeshoop' )    => (string) get_post_meta( $post->ID, '_ts_echeance', true ),
			__( 'Création', 'teeshoop' )    => (string) get_post_meta( $post->ID, '_ts_design_id', true ),
		);

		$product_id = (int) get_post_meta( $post->ID, '_ts_product_id', true );
		$estimate   = (int) get_post_meta( $post->ID, '_ts_estimate_ht', true );

		echo '<table class="widefat striped"><tbody>';
		foreach ( $rows as $label => $value ) {
			if ( '' === $value ) {
				continue;
			}
			printf( '<tr><th style="width:12em">%s</th><td>%s</td></tr>', esc_html( (string) $label ), esc_html( (string) $value ) );
		}
		if ( $product_id > 0 ) {
			printf(
				'<tr><th>%s</th><td><a href="%s">%s</a></td></tr>',
				esc_html__( 'Article', 'teeshoop' ),
				esc_url( (string) get_edit_post_link( $product_id ) ),
				esc_html( (string) get_the_title( $product_id ) )
			);
		}
		printf(
			'<tr><th>%s</th><td>%s</td></tr>',
			esc_html__( 'Estimation libre-service', 'teeshoop' ),
			esc_html(
				$estimate > 0
					? Money::format( $estimate ) . ' HT'
					: self::no_estimate( (string) get_post_meta( $post->ID, '_ts_estimate_why', true ) )
			)
		);
		echo '</tbody></table>';

		$message = (string) get_post_meta( $post->ID, '_ts_message', true );
		if ( '' !== $message ) {
			echo '<h4>' . esc_html__( 'Message', 'teeshoop' ) . '</h4>';
			echo '<p style="white-space:pre-wrap">' . esc_html( $message ) . '</p>';
		}

		echo '<p class="description">' . esc_html__( 'L’estimation est ce que la fiche produit aurait annoncé à cette quantité, au tarif public. Ce n’est pas un prix proposé au client.', 'teeshoop' ) . '</p>';

		self::render_document( $post->ID );
	}

	/**
	 * The document half of the screen: the versions, and what has moved.
	 *
	 * THE STALENESS LINE IS THE POINT. Chapitre 2 asks that a sent quote never
	 * change silently, and this is what "not silently" looks like: the number
	 * that was sent, the number today, and a sentence saying to send a new
	 * version before taking money. Recalculating it in place would be exactly
	 * the failure the chapter names.
	 */
	private static function render_document( int $post_id ): void {
		$versions = self::versions( $post_id );

		echo '<h4>' . esc_html__( 'Devis envoyés', 'teeshoop' ) . '</h4>';
		if ( empty( $versions ) ) {
			echo '<p>' . esc_html__( 'Aucune version n’a encore été établie.', 'teeshoop' ) . '</p>';
		} else {
			echo '<table class="widefat striped"><thead><tr>';
			printf(
				'<th>%s</th><th>%s</th><th>%s</th><th>%s</th>',
				esc_html__( 'Version', 'teeshoop' ),
				esc_html__( 'Numéro', 'teeshoop' ),
				esc_html__( 'Date', 'teeshoop' ),
				esc_html__( 'Total HT', 'teeshoop' )
			);
			echo '</tr></thead><tbody>';
			foreach ( array_reverse( $versions ) as $version ) {
				printf(
					'<tr><td>%d</td><td>%s</td><td>%s</td><td style="text-align:right">%s</td></tr>',
					(int) $version['version'],
					esc_html( (string) $version['number'] ),
					esc_html( (string) $version['date'] ),
					esc_html( Money::format( (int) $version['total_ht'] ) )
				);
			}
			echo '</tbody></table>';

			$moved = self::moved( $post_id );
			if ( '' !== $moved ) {
				printf( '<div class="notice notice-warning inline"><p>%s</p></div>', esc_html( $moved ) );
			}
		}

		$priced = self::price( $post_id );
		if ( empty( $priced['ok'] ) ) {
			printf( '<p class="description">%s</p>', esc_html( (string) $priced['reason'] ) );
			return;
		}
		printf(
			'<p class="description">%s</p>',
			esc_html(
				sprintf(
					/* translators: 1: an amount excl. VAT, 2: where the printed surfaces came from. */
					__( 'Aux conditions du jour : %1$s HT, surfaces %2$s.', 'teeshoop' ),
					Money::format( (int) $priced['total_ht'] ),
					'design' === $priced['source']
						? __( 'mesurées sur la création du client', 'teeshoop' )
						: __( 'au forfait par face, faute de création', 'teeshoop' )
				)
			)
		);
		if ( '' !== (string) $priced['reason'] ) {
			printf( '<p class="description">%s</p>', esc_html( (string) $priced['reason'] ) );
		}

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( self::ACTION_ISSUE );
		printf( '<input type="hidden" name="action" value="%s">', esc_attr( self::ACTION_ISSUE ) );
		printf( '<input type="hidden" name="devis_id" value="%d">', $post_id );
		printf(
			'<p><button type="submit" class="button">%s</button></p>',
			esc_html( empty( $versions ) ? __( 'Établir le devis', 'teeshoop' ) : __( 'Établir une nouvelle version', 'teeshoop' ) )
		);
		echo '</form>';
	}

	public static function handle_issue(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de faire cela.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION_ISSUE );

		$post_id = isset( $_POST['devis_id'] ) ? absint( wp_unslash( $_POST['devis_id'] ) ) : 0;
		if ( $post_id < 1 || self::POST_TYPE !== get_post_type( $post_id ) ) {
			wp_die( esc_html__( 'Cette demande n’existe pas.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}
		$issued = self::issue( $post_id );
		set_transient(
			'teeshoop_devis_' . get_current_user_id(),
			$issued['ok']
				? sprintf(
					/* translators: 1: a document number, 2: an amount excl. VAT. */
					__( 'Devis %1$s établi, %2$s HT.', 'teeshoop' ),
					(string) $issued['version']['number'],
					Money::format( (int) $issued['version']['total_ht'] )
				)
				: (string) $issued['reason'],
			60
		);
		wp_safe_redirect( (string) get_edit_post_link( $post_id, 'raw' ) );
		exit;
	}

	/** A state selector in the publish box, because WordPress's own hides custom statuses. */
	public static function status_control( \WP_Post $post ): void {
		if ( self::POST_TYPE !== $post->post_type ) {
			return;
		}
		wp_nonce_field( 'teeshoop_devis_status', 'teeshoop_devis_status_nonce' );
		echo '<div class="misc-pub-section"><label for="teeshoop-devis-status"><strong>' . esc_html__( 'État de la demande', 'teeshoop' ) . '</strong></label><br>';
		echo '<select name="teeshoop_devis_status" id="teeshoop-devis-status">';
		foreach ( self::STATUSES as $slug => $label ) {
			printf(
				'<option value="%s" %s>%s</option>',
				esc_attr( $slug ),
				selected( $slug, $post->post_status, false ),
				esc_html( $label )
			);
		}
		echo '</select></div>';
	}

	public static function save_status( int $post_id, \WP_Post $post ): void {
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}
		$nonce = isset( $_POST['teeshoop_devis_status_nonce'] ) ? sanitize_text_field( wp_unslash( (string) $_POST['teeshoop_devis_status_nonce'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, 'teeshoop_devis_status' ) ) {
			return;
		}
		$wanted = isset( $_POST['teeshoop_devis_status'] ) ? sanitize_key( wp_unslash( (string) $_POST['teeshoop_devis_status'] ) ) : '';
		if ( ! isset( self::STATUSES[ $wanted ] ) || $wanted === $post->post_status ) {
			return;
		}

		remove_action( 'save_post_' . self::POST_TYPE, array( self::class, 'save_status' ), 10 );
		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => $wanted,
			)
		);
		add_action( 'save_post_' . self::POST_TYPE, array( self::class, 'save_status' ), 10, 2 );
	}

	// ── the devis as a DOCUMENT ──────────────────────────────────────────────
	//
	// Everything above is the REQUEST: a message with a state, which is what a
	// prospect sends. Everything below is the document we send back, and it is
	// a different object with a different rule: chapitre 2 says « chaque envoi
	// crée une version [...] le client doit accepter la version exacte qu'il
	// paie », so a sent quote can never change under the customer's feet.
	//
	// `docs/ROADMAP.md` carried this as an assumed exception since session 05,
	// with two halves: no `POST /pricing/quotes/calculate`, because the costing
	// engine takes a `WC_Order` and a devis had no lines; and no version chain,
	// because there was no document to version. Both are closed here.

	/** Post meta: every version, oldest first, JSON. */
	public const META_VERSIONS = '_ts_versions';

	/** The invoice sequence's series for devis numbers. */
	public const SERIES_PREFIX = 'DE';

	public const ACTION_ISSUE = 'teeshoop_devis_version';

	/**
	 * The lines this devis is for.
	 *
	 * ONE LINE TODAY, and that is the request's own shape rather than a
	 * limitation invented here: the form asks for one product, one quantity and
	 * one size grid, so that is what there is to price. The function returns a
	 * LIST because the document's shape must not have to change the day the form
	 * grows a second line, and because everything downstream (the pricing, the
	 * costing, the totals) is written over a list already.
	 *
	 * THE SURFACES COME FROM THE DESIGN WHEN THERE IS ONE. `Pricing::standard_sides`
	 * is the shorthand a public grid uses, N faces at the standard tier, and it
	 * is what the request was estimated with because a prospect who has not been
	 * in the studio has no artwork to measure. A devis with a design id is a
	 * different thing: the Worker holds the measured ink of every printed side,
	 * and quoting the shorthand instead would offer a price that the cart will
	 * not honour.
	 *
	 * @return array{lines:array,source:string,reason:string}
	 */
	public static function lines( int $post_id ): array {
		$garment = (string) get_post_meta( $post_id, '_ts_garment', true );
		$qty     = (int) get_post_meta( $post_id, '_ts_qty', true );
		$faces   = (int) get_post_meta( $post_id, '_ts_faces', true );
		$design  = (string) get_post_meta( $post_id, '_ts_design_id', true );

		if ( '' === $garment || $qty < 1 ) {
			return array(
				'lines'  => array(),
				'source' => '',
				'reason' => 'Cette demande ne dit ni quel vêtement ni combien : il n’y a rien à chiffrer.',
			);
		}

		$source = 'faces';
		$sides  = Pricing::standard_sides( max( 1, $faces ) );
		$reason = '';

		if ( '' !== $design ) {
			$check = Design::verify( $design );
			if ( empty( $check['ok'] ) ) {
				/*
				 * FAIL CLOSED, and say which of the two it is. A design the
				 * Worker could not confirm is not a design that prints nothing:
				 * quoting the face shorthand here would put a price on a
				 * document while the artwork it is for might be larger than the
				 * standard tier, and the cart would then refuse the very order
				 * this document offered.
				 */
				return array(
					'lines'  => array(),
					'source' => '',
					'reason' => sprintf(
						'La création jointe à cette demande n’a pas pu être confirmée (%s). Rien n’est chiffré tant qu’on ne sait pas ce qui est imprimé.',
						(string) $check['reason']
					),
				);
			}
			$measured = Design::normalise_sides( $check['meta']['sides'] ?? array() );
			if ( ! empty( $measured ) ) {
				$sides  = $measured;
				$source = 'design';
			} else {
				$reason = 'La création jointe ne déclare aucune surface mesurée : le chiffrage retient les faces standard.';
			}
		}

		return array(
			'lines'  => array(
				array(
					'product_id' => (int) get_post_meta( $post_id, '_ts_product_id', true ),
					'garment'    => $garment,
					'qty'        => $qty,
					'sides'      => $sides,
					'design_id'  => $design,
					'sizes'      => json_decode( (string) get_post_meta( $post_id, '_ts_tailles', true ), true ) ?: array(),
				),
			),
			'source' => $source,
			'reason' => $reason,
		);
	}

	/**
	 * What this devis would be sold for, today, from `Pricing` and nothing else.
	 *
	 * @return array{ok:bool,lines?:array,total_ht?:int,reason?:string}
	 */
	public static function price( int $post_id ): array {
		$read = self::lines( $post_id );
		if ( empty( $read['lines'] ) ) {
			return array(
				'ok'     => false,
				'reason' => (string) $read['reason'],
			);
		}

		$config = Settings::pricing();
		$out    = array();
		$total  = 0;
		foreach ( $read['lines'] as $line ) {
			try {
				$quote = Pricing::quote(
					array(
						'garment' => (string) $line['garment'],
						'qty'     => (int) $line['qty'],
						'sides'   => (array) $line['sides'],
					),
					$config
				);
			} catch ( \InvalidArgumentException $e ) {
				return array(
					'ok'     => false,
					'reason' => 'Ce vêtement n’est plus au catalogue : le devis ne peut pas être chiffré.',
				);
			}
			$out[]  = array_merge( $line, array(
				'unit_ht'  => (int) $quote['unit_ht'],
				'total_ht' => (int) $quote['total_ht'],
			) );
			$total += (int) $quote['total_ht'];
		}

		return array(
			'ok'       => true,
			'lines'    => $out,
			'total_ht' => $total,
			'source'   => (string) $read['source'],
			'reason'   => (string) $read['reason'],
		);
	}

	/**
	 * Freeze a version and give it a number.
	 *
	 * WHY A NUMBER FROM THE INVOICE SEQUENCE. It is the same table, the same
	 * atomic `LAST_INSERT_ID` idiom and the same collision proof, under its own
	 * series: a devis number that repeats is a customer holding two different
	 * offers called the same thing. Building a second counter would be a second
	 * thing to get right, and this one has already been driven by six concurrent
	 * processes for twenty-five numbers each.
	 *
	 * WHAT IS FROZEN AND WHY EACH. The lines and their prices, because that is
	 * the offer. The VAT regime in force, because a devis crossing the franchise
	 * threshold must not silently become a different total. The pricing config's
	 * own version, because a rate the associate changes next month must not
	 * rewrite an offer already sent. What is NOT frozen is a validity period:
	 * question 38 is unanswered and its written default says explicitly that no
	 * duration is displayed anywhere until it comes back.
	 *
	 * @return array{ok:bool,version?:array,reason?:string}
	 */
	public static function issue( int $post_id ): array {
		$priced = self::price( $post_id );
		if ( empty( $priced['ok'] ) ) {
			return array(
				'ok'     => false,
				'reason' => (string) $priced['reason'],
			);
		}

		$regime   = Settings::vat();
		$versions = self::versions( $post_id );
		$date     = Settings::today();
		$series   = self::series( $date );
		$number   = Invoice::next_number( $series );
		if ( $number < 1 ) {
			// 0 is never issued: `Invoice::next_number` returns it when the
			// database refused, and a document with no number is not a document.
			return array(
				'ok'     => false,
				'reason' => 'Le numéro de devis n’a pas pu être attribué. Rien n’a été envoyé.',
			);
		}

		$version = array(
			'version'  => count( $versions ) + 1,
			'number'   => Invoice::format_number( $series, $number ),
			'date'     => $date,
			'at'       => gmdate( 'c' ),
			'by'       => function_exists( 'get_current_user_id' ) ? get_current_user_id() : 0,
			'lines'    => $priced['lines'],
			'total_ht' => (int) $priced['total_ht'],
			'regime'   => (string) $regime['regime'],
			'rate'     => (float) $regime['rate'],
			'mention'  => (string) $regime['mention'],
			'source'   => (string) $priced['source'],
			'config'   => Settings::pricing(),
		);

		$versions[] = $version;
		update_post_meta( $post_id, self::META_VERSIONS, wp_json_encode( $versions ) );

		return array(
			'ok'      => true,
			'version' => $version,
		);
	}

	/**
	 * The devis series for a date, mirroring `Invoice::series`.
	 *
	 * COPIES ITS SHAPE INCLUDING THE ENVIRONMENT SWITCH, which is the part that
	 * matters: outside production the series is a rehearsal one, so a dress
	 * rehearsal cannot consume numbers out of a sequence a real customer's
	 * offers are counted in.
	 *
	 * AND IT IS A DIFFERENT REHEARSAL SERIES FROM THE INVOICE'S. The first
	 * version returned plain `ESSAI` + year, which is exactly what
	 * `Invoice::series` returns off production, so on the mirror and on the
	 * preproduction every devis burned an invoice number out of the same
	 * counter. The invoice suite caught it as a hole in a sequence that is
	 * required by law to have none, intermittently, depending on the order the
	 * suites happened to run in. In production the two never collided, which is
	 * what would have made this a surprise on the day somebody rehearsed.
	 */
	public static function series( string $iso_date ): string {
		$year = substr( $iso_date, 0, 4 );
		return ( 'production' === Legal::environment() ? self::SERIES_PREFIX : 'ESSAIDE' ) . $year;
	}

	/** @return array<int,array<string,mixed>> */
	public static function versions( int $post_id ): array {
		$raw = (string) get_post_meta( $post_id, self::META_VERSIONS, true );
		if ( '' === $raw ) {
			return array();
		}
		$rows = json_decode( $raw, true );
		return is_array( $rows ) ? $rows : array();
	}

	/** The version in force, or null. */
	public static function current( int $post_id ): ?array {
		$all = self::versions( $post_id );
		return empty( $all ) ? null : $all[ count( $all ) - 1 ];
	}

	/**
	 * Whether a sent version still describes what the shop would sell today.
	 *
	 * THE POINT OF THE VERSION CHAIN, and the thing the chapter asks for in as
	 * many words. A devis is a firm offer for as long as it stands, so what
	 * matters is not that the price moved but that somebody can SEE it moved
	 * before the customer pays: the answer is a sentence, not a silent
	 * recalculation. `Costing::staleness` does the same job for an order's cost
	 * report and this is its shape.
	 */
	public static function moved( int $post_id ): string {
		$current = self::current( $post_id );
		if ( null === $current ) {
			return '';
		}
		$now = self::price( $post_id );
		if ( empty( $now['ok'] ) ) {
			return (string) $now['reason'];
		}
		if ( (int) $now['total_ht'] === (int) $current['total_ht'] ) {
			return '';
		}
		return sprintf(
			'Le devis %1$s annonce %2$s HT ; aux conditions du jour la même commande vaut %3$s HT. Envoyez une nouvelle version avant de faire payer.',
			(string) $current['number'],
			Money::format( (int) $current['total_ht'] ),
			Money::format( (int) $now['total_ht'] )
		);
	}

	/**
	 * What this devis would COST us, and what its floor price is.
	 *
	 * THIS IS `POST /pricing/quotes/calculate`, and it is the whole of it. The
	 * chapter describes an HTTP route; what it actually specifies is a
	 * computation, and that computation is `Costing::compute()`, which has been
	 * correct since session 05 and takes a `WC_Order`. So a devis is handed to
	 * it AS an order, built in memory from the lines above and never saved.
	 *
	 * NOT A SECOND ENGINE, which is the rule this obeys and the reason the
	 * roadmap held the route open rather than writing one. Everything the
	 * costing reads off an order is a property or a piece of item meta, so an
	 * unsaved `WC_Order` carrying the same item meta the cart would have written
	 * is the same input. What is NOT done is `calculate_totals()`: WooCommerce's
	 * own implementation ends in `$this->save()`, so calling it would write a
	 * phantom order into the shop for every quote anyone costed. The totals are
	 * set from `Pricing` instead, which is where they come from anyway.
	 *
	 * AND IT IS NOT A PUBLIC ROUTE, which is a departure from the chapter worth
	 * naming. What comes back is our purchase cost, our film economics, our
	 * floor price and our commission. The chapter draws `/pricing/quotes/...`
	 * beside the customer-facing endpoints; exposing this one would put the shop
	 * on the wrong side of the boundary `scripts/php-guard.mjs` and
	 * `scripts/bundle-guard.mjs` exist to hold. It is reachable from the devis
	 * screen, by somebody with `manage_woocommerce`, and from nowhere else.
	 *
	 * @return array{ok:bool,report?:array,reason?:string}
	 */
	public static function costing( int $post_id ): array {
		$priced = self::price( $post_id );
		if ( empty( $priced['ok'] ) ) {
			return array(
				'ok'     => false,
				'reason' => (string) $priced['reason'],
			);
		}

		$order = new \WC_Order();
		foreach ( $priced['lines'] as $line ) {
			$item = new \WC_Order_Item_Product();
			$item->set_name( (string) $line['garment'] );
			$item->set_quantity( (int) $line['qty'] );
			$item->set_subtotal( (string) Money::to_eur( (int) $line['total_ht'] ) );
			$item->set_total( (string) Money::to_eur( (int) $line['total_ht'] ) );
			// THE SAME KEYS THE CART WRITES. `Costing` reads these and nothing
			// else off a line; spelling one of them differently here would make
			// the devis cost a different order from the one it becomes.
			$item->add_meta_data( '_teeshoop_garment', (string) $line['garment'], true );
			$item->add_meta_data( '_teeshoop_sides', wp_json_encode( $line['sides'] ), true );
			$item->add_meta_data( '_teeshoop_design_id', (string) $line['design_id'], true );
			$item->add_meta_data( '_teeshoop_size_grid', wp_json_encode( $line['sizes'] ), true );
			$order->add_item( $item );
		}

		$order->set_total( (string) Money::to_eur( (int) $priced['total_ht'] ) );

		return array(
			'ok'     => true,
			'report' => Costing::compute( $order ),
			'source' => (string) $priced['source'],
		);
	}
}
