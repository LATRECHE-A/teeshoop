<?php
/**
 * What we are allowed to write on a visitor's machine, and when.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE, WHICH IS STRICTER THAN THE BANNER EVERYONE COPIES
 *
 * Article 82 of the loi Informatique et Libertés covers anything READ FROM or
 * WRITTEN TO a terminal, not just cookies: localStorage, sessionStorage, a
 * fingerprint, a pixel. The CNIL's position on the rest is short and this file
 * follows it literally:
 *
 *   1. Nothing non-essential before a choice. Not "loaded but inactive": NOT
 *      LOADED. A tag that arrives and waits is already a read of the terminal.
 *   2. Refusing is as easy as accepting. One click, the same level, the same
 *      prominence. A "Tout accepter" button beside a "Paramétrer" link is a
 *      dark pattern the CNIL has fined for by name.
 *   3. No pre-ticked box, and silence is not consent.
 *   4. The choice is recorded, dated, versioned, and withdrawable from a
 *      control that stays on every page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS SHOP NEEDS A BANNER AT ALL, WHICH IS NOT OBVIOUS
 *
 * Most of what a shop wants to measure does not need one. Our audience and
 * conversion figures are computed from records we already hold (see `Funnel`):
 * a quote request is a post, an order is an order, and counting them writes
 * nothing to anybody's machine and processes no personal data. That measurement
 * is therefore outside article 82 entirely, needs no consent, and runs always.
 *
 * ONE THING DOES need consent, and it is the one chapter 07 asks for by name
 * when it lists « mauvaise attribution » among its risks: knowing WHICH PAGE
 * produced a quote request. Carrying a visitor's first landing page across the
 * two or three pages they read before they fill the form means writing an
 * identifier on their machine, and joining it to a named prospect afterwards
 * means it is not anonymous statistics. That is not exempt under the CNIL's
 * audience-measurement doctrine, so it is opt-in, and it is the thing this gate
 * gates.
 *
 * AND THE OTHER THING THAT NEEDED IT WAS ALREADY RUNNING. WooCommerce 11's
 * « Origine de la commande » enqueues sourcebuster on every front-end page and
 * writes SEVEN first-party cookies from JavaScript before a visitor has been
 * asked anything: `sbjs_first`, `sbjs_current`, their two `_add` twins, a
 * `sbjs_session` page counter, `sbjs_migrations`, and `sbjs_udata`, which
 * carries the full User-Agent string. Measured in Chromium on 26/08/2026 on a
 * first, cookie-less arrival at `/?utm_source=google&utm_medium=cpc`:
 *
 *   sbjs_udata   = vst=1|||uip=(none)|||uag=Mozilla/5.0 (X11; Linux x86_64) …
 *   sbjs_first   = typ=utm|||src=google|||mdm=cpc|||cmp=test|||…
 *   sbjs_session = pgs=1|||cpg=http://localhost:8080/?utm_source=google&…
 *
 * Pressing « Tout refuser » changed nothing: on the next page `pgs` read 3.
 * That is more than this file's own attribution cookie ever collected (a path
 * with no query string, a referring host and a campaign), it is written before
 * the choice rather than after it, and it lands on the ORDER as
 * `_wc_order_attribution_user_agent` and `_wc_order_attribution_session_entry`
 * beside a named, paying customer. It is the failure the CNIL fines by name.
 *
 * IT WAS INVISIBLE TO THE GATE THAT EXISTS. `scripts/seo-verify.mjs` asserts
 * « une première visite ne dépose aucun traceur » by listing `Set-Cookie`
 * headers on a raw fetch. A cookie written by `document.cookie` has no such
 * header, so the assertion could not see it and the gate was green for four
 * sessions. `scripts/consent-verify.mjs` drives a real browser for exactly this
 * reason, and asserts on storage rather than on headers.
 *
 * SO THE SCRIPTS ARE NOT ENQUEUED AT ALL until the visitor allows it, which is
 * rule 1 above taken literally, and any `sbjs_` cookie already on the machine is
 * expired server side on the first request after a refusal. WooCommerce's own
 * `wc_order_attribution_allow_tracking` filter is answered too, so that a code
 * path which enqueues them some other way still finds tracking switched off.
 * Both, because one of them is a belt.
 *
 * THE ADVERTISING CATEGORY IS GONE. It used to be declared here and offered the
 * day an advertising tag id was stored in an option. Nothing in this repository
 * loads an advertising tag, and `granted( 'publicite' )` had no reader anywhere,
 * so storing an id would have made the banner ask a visitor for a permission
 * that gated nothing while an operator believed the tag was under control. A
 * permission nobody reads is worse than no permission. The day a tag is
 * installed, the code that installs it declares the category and reads the
 * gate, in one place, and `scripts/consent-verify.mjs` gains the assertion.
 *
 * IT WORKS WITHOUT JAVASCRIPT, and there is no JavaScript at all. The banner is
 * a form, the choice is a POST, the cookie is set by PHP on the redirect. This
 * is not purity: a consent mechanism whose refuse button depends on a script is
 * a mechanism that fails open on the visitor whose script was blocked, and
 * failing open is the one direction this must never fail.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Consent {

	/** The cookie carrying the visitor's own decision. */
	public const COOKIE = 'teeshoop_choix';

	/**
	 * The cookie the attribution category is about.
	 *
	 * Named separately and publicly because two other things read it: `Quote`
	 * copies it onto a request, and the verification script asserts it is
	 * ABSENT before a choice and PRESENT after one. A gate nobody can check
	 * from outside is a gate nobody can trust.
	 */
	public const SOURCE_COOKIE = 'teeshoop_src';

	/**
	 * Bumped when the categories change meaning.
	 *
	 * A stored consent carries the version it was given under. Adding a purpose
	 * and reading an old consent as covering it is the exact thing consent is
	 * supposed to prevent, so an older version is treated as no choice at all
	 * and the visitor is asked again.
	 *
	 * 1 to 2 ON 26/08/2026, and this is the manoeuvre the paragraph above
	 * describes rather than a tidy-up. « Savoir par quelle page vous êtes
	 * arrivé » used to mean one cookie holding three strings. It now also
	 * governs WooCommerce's own sourcebuster, which writes seven and one of them
	 * holds the User-Agent. A visitor who allowed the first was never asked
	 * about the second, so their consent does not cover it and they are asked
	 * again.
	 */
	private const VERSION = 2;

	/** How long a choice is kept, seconds. The CNIL's ceiling is 13 months. */
	private const KEEP = 13 * 30 * DAY_IN_SECONDS;

	/** The form action, and the only way a choice is recorded. */
	public const ACTION = 'teeshoop_consentement';

	/**
	 * The cookies WooCommerce's order attribution writes, by prefix.
	 *
	 * Named here because two things need it: the gate that stops them being
	 * written, and the sweep that removes the ones a visitor already carries.
	 * A prefix rather than a list, because sourcebuster's own migration key
	 * (`sbjs_migrations`) is versioned and would be missed by a fixed list.
	 */
	private const WOO_PREFIX = 'sbjs_';

	/** Parsed once per request: the granted categories, or null for no choice. */
	private static ?array $choice = null;

	/** Whether `read()` has run, since "no choice" is itself a value. */
	private static bool $read = false;

	public static function init(): void {
		add_action( 'admin_post_nopriv_' . self::ACTION, array( self::class, 'record' ) );
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'record' ) );

		/*
		 * The attribution cookie is written server side, on the first request
		 * after the visitor has allowed it, and never before. `init` rather than
		 * a template hook because `setcookie()` has to run before a byte of
		 * output, and a page that has begun streaming cannot set one.
		 */
		add_action( 'init', array( self::class, 'remember_source' ) );

		/*
		 * The same instant, and for the same reason: a `Set-Cookie` that expires
		 * somebody's stale sourcebuster cookies cannot be sent once the page has
		 * begun streaming. Priority 11 so it runs after `remember_source`, which
		 * is the writer; this one is only ever a remover.
		 */
		add_action( 'init', array( self::class, 'forget_woocommerce_attribution' ), 11 );

		/*
		 * AND OUR OWN, ON THE SAME TERMS, WHICH IS A FIX.
		 *
		 * `choice()` treats a cookie written under an older `VERSION` as no
		 * choice at all, which is right. But `remember_source()` returns early
		 * when `teeshoop_src` is already set, and `forget_source()` was reachable
		 * only from a fresh submission. So a visitor who had consented under
		 * version 1 kept an attribution cookie that nothing read, that they could
		 * not clear from any control we offer, and that outlived the consent it
		 * came from by up to thirteen months. Bumping `VERSION` to 2 today is
		 * exactly the manoeuvre that would have caused it on every visitor at
		 * once.
		 */
		add_action( 'init', array( self::class, 'forget_stale_source' ), 11 );

		/*
		 * BOTH HALVES OF THE SAME REFUSAL. The filter is WooCommerce's own
		 * switch and it makes the script, if it ever loads, delete what it wrote.
		 * The dequeue is the rule the CNIL actually states: not loaded. Priority
		 * 99 on `wp_enqueue_scripts` because `OrderAttributionController` enqueues
		 * at the default 10 and a dequeue before an enqueue removes nothing.
		 */
		add_filter( 'wc_order_attribution_allow_tracking', array( self::class, 'woocommerce_may_track' ) );
		add_action( 'wp_enqueue_scripts', array( self::class, 'dequeue_woocommerce_attribution' ), 99 );

		/*
		 * FIRST IN THE DOCUMENT, NOT LAST. Rendered from `wp_footer`, the panel
		 * came after the whole page: 49 presses of Tab to reach « Tout refuser »,
		 * measured on 28 September 2026, for a question that is asked before
		 * anything else. `wp_body_open` puts it at the top of the tab order; the
		 * footer stays as the fallback for a template that does not fire it, and
		 * `render()` prints once whichever runs first. It is fixed-position, so
		 * the move changes nothing on screen.
		 */
		add_action( 'wp_body_open', array( self::class, 'render' ), 5 );
		add_action( 'wp_footer', array( self::class, 'render' ), 20 );

		/*
		 * WOOCOMMERCE'S OWN TELEMETRY, KEPT TO THE PEOPLE WHO RUN THE SHOP. With
		 * « usage tracking » on, WooCommerce writes a `tk_ai` identifier on any
		 * `admin_init`, and `admin-post.php` fires it: the very form that records
		 * « Tout refuser » left a visitor with an Automattic tracking cookie,
		 * measured on 28 September 2026. It is the shop staff's opt-in, made in
		 * the WooCommerce settings; a visitor never made it.
		 */
		add_filter( 'woocommerce_apply_user_tracking', array( self::class, 'staff_tracking_only' ) );
	}

	/** @param bool $track WooCommerce's answer so far. */
	public static function staff_tracking_only( $track ): bool {
		return (bool) $track && current_user_can( 'manage_woocommerce' );
	}

	// -----------------------------------------------------------------------
	// WooCommerce's own tracker
	// -----------------------------------------------------------------------

	/**
	 * Whether WooCommerce may run its order-attribution tracking.
	 *
	 * @param mixed $allowed WooCommerce's own default, which is `true`.
	 */
	public static function woocommerce_may_track( $allowed = true ): bool {
		return (bool) $allowed && self::granted( 'attribution' );
	}

	/**
	 * Take sourcebuster off the page when the visitor has not allowed it.
	 *
	 * `wc-order-attribution` depends on `sourcebuster-js`, so dropping the
	 * dependency alone would leave the dependent enqueued and WordPress would
	 * print it with a missing dependency. Both go, and in that order.
	 */
	public static function dequeue_woocommerce_attribution(): void {
		if ( self::granted( 'attribution' ) ) {
			return;
		}
		wp_dequeue_script( 'wc-order-attribution' );
		wp_deregister_script( 'wc-order-attribution' );
		wp_dequeue_script( 'sourcebuster-js' );
		wp_deregister_script( 'sourcebuster-js' );
	}

	/**
	 * Expire any sourcebuster cookie the visitor is already carrying.
	 *
	 * WHY THIS IS SERVER SIDE. WooCommerce removes its own cookies from
	 * JavaScript, in `order-attribution.js`, when `allowTracking` is false. We
	 * do not load that script at all, so nothing would run. And its removal
	 * writes `domain=.{hostname}` while sourcebuster wrote them host-only, which
	 * on a real domain are two different cookies: on `localhost` Chromium
	 * removed them anyway, but that is a property of localhost and not something
	 * to ship a compliance claim on.
	 *
	 * SO IT IS DONE HERE, host-only and path `/`, matching exactly how they were
	 * written, and only when there is something to remove: a `Set-Cookie` per
	 * request for cookies nobody has is noise in every response of the shop.
	 */
	public static function forget_woocommerce_attribution(): void {
		if ( is_admin() || wp_doing_cron() || self::granted( 'attribution' ) ) {
			return;
		}
		if ( headers_sent() ) {
			return;
		}
		foreach ( array_keys( $_COOKIE ) as $name ) {
			$name = (string) $name;
			if ( ! str_starts_with( $name, self::WOO_PREFIX ) ) {
				continue;
			}
			setcookie(
				$name,
				'',
				array(
					'expires' => time() - YEAR_IN_SECONDS,
					'path'    => '/',
				)
			);
			unset( $_COOKIE[ $name ] );
		}
	}

	// -----------------------------------------------------------------------
	// The categories
	// -----------------------------------------------------------------------

	/**
	 * What we would like to do, in the visitor's terms, and whether we can.
	 *
	 * `offered` is false for a purpose that has nothing behind it today. A
	 * checkbox for a tag that is not installed asks somebody to decide about a
	 * thing that does not exist, and the permission would sit there waiting for
	 * a tag nobody reviewed. Today every declared category is offered; the shape
	 * is kept because the day a purpose is added it arrives switched off.
	 *
	 * @return array<string,array{label:string,detail:string,offered:bool}>
	 */
	public static function categories(): array {
		return array(
			'attribution' => array(
				'label'   => __( 'Savoir par quelle page vous êtes arrivé', 'teeshoop' ),
				/*
				 * IT DESCRIBES WHAT IS ACTUALLY WRITTEN, and it used to say
				 * « un identifiant ». There is no identifier: our own cookie
				 * holds three strings, and a data subject who is told something
				 * vaguer than the truth has not been informed.
				 *
				 * AND IT NOW DESCRIBES BOTH WRITERS. This category used to name
				 * only our cookie while WooCommerce's sourcebuster wrote seven
				 * more, ungated, one of them carrying the User-Agent. Gating them
				 * without saying so would have been the same failure the other
				 * way round: a description that understates what is written is
				 * not information, whichever direction it errs in.
				 */
				'detail'  => __( 'Nous enregistrons sur votre appareil la page par laquelle vous êtes arrivé, le site qui vous a envoyé et le nom de la campagne s’il y en a une, pendant treize mois. La boutique y ajoute, pour la durée de votre visite seulement, un compteur de pages et le nom de votre navigateur, qui servent à rattacher une commande à la page qui l’a amenée. Si vous demandez un devis, les trois premières informations sont recopiées sur votre demande. Refuser n’enlève rien au site.', 'teeshoop' ),
				'offered' => true,
			),
		);
	}

	/** The keys a visitor can actually be asked about right now. */
	public static function offered(): array {
		return array_keys( array_filter( self::categories(), static fn( array $c ): bool => $c['offered'] ) );
	}

	// -----------------------------------------------------------------------
	// Reading the choice
	// -----------------------------------------------------------------------

	/**
	 * The categories this visitor has allowed, or null if they have not chosen.
	 *
	 * NULL AND THE EMPTY ARRAY ARE DIFFERENT and the whole file turns on it:
	 * null means "not asked yet, show the banner, write nothing", the empty
	 * array means "asked and refused everything, do not ask again, write
	 * nothing". Reading a refusal as an absence is how a banner comes back on
	 * every page for somebody who already said no.
	 *
	 * @return string[]|null
	 */
	public static function choice(): ?array {
		if ( self::$read ) {
			return self::$choice;
		}
		self::$read   = true;
		self::$choice = null;

		$raw = isset( $_COOKIE[ self::COOKIE ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::COOKIE ] ) ) : '';
		if ( '' === $raw ) {
			return null;
		}

		// v<version>:<yyyy-mm-dd>:<key,key> and nothing else is accepted.
		if ( ! preg_match( '/^v(\d+):(\d{4}-\d{2}-\d{2}):([a-z,]*)$/', $raw, $m ) ) {
			return null;
		}
		if ( (int) $m[1] !== self::VERSION ) {
			return null;
		}

		$known        = array_keys( self::categories() );
		$granted      = array_values( array_intersect( array_filter( explode( ',', $m[3] ) ), $known ) );
		self::$choice = $granted;
		return self::$choice;
	}

	/** Whether a purpose is allowed. False when nobody has been asked yet. */
	public static function granted( string $key ): bool {
		$choice = self::choice();
		return is_array( $choice ) && in_array( $key, $choice, true );
	}

	/**
	 * The date the current choice was made, or '' when there is none.
	 *
	 * IT ASKS `choice()` FIRST, and that is a fix. This read the cookie with a
	 * second regular expression that did not check the version, so the day
	 * `VERSION` is bumped, which is exactly the manoeuvre this file documents
	 * for when the purposes change, every visitor would have met the banner
	 * saying nothing is decided and the footer saying they chose on such a date.
	 * Two consent controls contradicting each other on one page. Reproducible
	 * today with a `v2:` cookie. One cookie, one parser.
	 */
	public static function decided_on(): string {
		if ( null === self::choice() ) {
			return '';
		}
		$raw = isset( $_COOKIE[ self::COOKIE ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::COOKIE ] ) ) : '';
		return preg_match( '/^v\d+:(\d{4}-\d{2}-\d{2}):/', $raw, $m ) ? $m[1] : '';
	}

	// -----------------------------------------------------------------------
	// Recording it
	// -----------------------------------------------------------------------

	/**
	 * Write the choice, then send the visitor back where they were.
	 *
	 * 303 rather than 302, so the browser turns the POST into a GET and a
	 * refresh does not re-submit the form. The return URL is validated against
	 * this site: an open redirect on a page every visitor of a shop meets is a
	 * phishing hop, and `wp_safe_redirect` is what refuses one.
	 */
	public static function record(): void {
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- the two checks below are the verification.
		$back = isset( $_POST['retour'] ) ? esc_url_raw( wp_unslash( $_POST['retour'] ) ) : '';

		/*
		 * THE ORIGIN IS THE DEFENCE, NOT THE NONCE.
		 *
		 * This was `check_admin_referer()` alone and that is not a CSRF defence
		 * for a logged-out visitor. WordPress computes a nonce for user 0 with an
		 * empty session token, so EVERY anonymous visitor of the shop is served
		 * the same string, and it is printed in the footer of every public page.
		 * Measured: three cookie-less GETs of `/`, `/entreprises/` and `/shop/`
		 * returned one identical `_wpnonce`. Harvest it with one request, put a
		 * self-submitting form on any site, and a visitor who clicked nothing
		 * leaves with `teeshoop_choix=…:attribution` written on their machine,
		 * the banner gone, and the footer telling them they chose today. The
		 * attacker's own Referer then lands in the attribution cookie, so they
		 * pick the campaign too. A consent a third party can cause is not a
		 * consent, which makes this the one defect in this file that matters.
		 *
		 * `===`, never `startsWith`: the rule is section 4 of the brief and the
		 * reason is `teeshoop.com.evil.tld`. Absent, we fall back to the referring
		 * host, and absent that we REFUSE: "we could not tell" is not "it is us".
		 */
		if ( ! self::same_origin() ) {
			wp_safe_redirect( self::back_to( $back, true ), 303 );
			exit;
		}

		/*
		 * The nonce still runs, and its failure is now RECOVERABLE.
		 *
		 * `check_admin_referer()` ends in `wp_die()`, so a visitor who left a tab
		 * open overnight met a WordPress error page on the refuse button and
		 * their refusal was not recorded: the banner then asked again on every
		 * page. Measured: 403, « Le lien suivi est expiré. », no Set-Cookie. A
		 * refusal that depends on a token with a twelve-hour life is a refusal
		 * that expires, and this file's own header says that is the direction it
		 * must never fail in. So a stale nonce sends them back to the panel with
		 * a fresh one instead of to an error page.
		 */
		$nonce = isset( $_POST['_wpnonce'] ) ? sanitize_text_field( wp_unslash( $_POST['_wpnonce'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, self::ACTION ) ) {
			wp_safe_redirect( self::back_to( $back, true ), 303 );
			exit;
		}

		$granted = array();
		if ( isset( $_POST['tout'] ) ) {
			$granted = self::offered();
		} elseif ( ! isset( $_POST['rien'] ) ) {
			$raw = isset( $_POST['categories'] ) && is_array( $_POST['categories'] )
				? array_map( 'sanitize_key', array_filter( wp_unslash( $_POST['categories'] ), 'is_scalar' ) )
				: array();
			$granted = array_values( array_intersect( $raw, self::offered() ) );
		}
		// phpcs:enable WordPress.Security.NonceVerification.Missing

		self::write( $granted );

		/*
		 * THE ORIGIN IS CAPTURED HERE, AT THE MOMENT OF CONSENT, and that is a
		 * correction rather than an optimisation.
		 *
		 * `remember_source()` runs on `init` of the NEXT request, by which time
		 * the referring site is us and the campaign arguments are gone: the two
		 * fields the attribution category exists to fill were therefore
		 * structurally always empty, and the banner was asking permission for
		 * something that never worked. The banner is rendered on the page the
		 * visitor ARRIVED on, so it carries that page's referring host and
		 * campaign as hidden fields, and they are read once, here.
		 *
		 * They come from the client and are therefore untrusted, exactly as the
		 * `Referer` header they were read from already was. They are bounded and
		 * sanitised on the way in, they are only ever aggregated, and they are
		 * escaped where they are printed.
		 */
		if ( in_array( 'attribution', $granted, true ) ) {
			// phpcs:disable WordPress.Security.NonceVerification.Missing -- verified above.
			$ref  = isset( $_POST['src_ref'] ) ? sanitize_text_field( wp_unslash( $_POST['src_ref'] ) ) : '';
			$camp = isset( $_POST['src_camp'] ) ? sanitize_text_field( wp_unslash( $_POST['src_camp'] ) ) : '';
			// phpcs:enable WordPress.Security.NonceVerification.Missing
			self::write_source( (string) wp_parse_url( $back, PHP_URL_PATH ), $ref, $camp );
		}

		/*
		 * WITHDRAWING STOPS THE COLLECTION AND ERASES THE COOKIE, and that is
		 * exactly what it does, no more.
		 *
		 * This comment used to claim withdrawal "deletes what it allowed". It
		 * does not: a visitor who consented, submitted a quote request, then
		 * withdrew leaves the three fields copied onto that request. That is not
		 * a bug to fix here, because the request is a document they asked us to
		 * act on and it has its own three-year retention and its own erasure
		 * route through WordPress's privacy tools, which `Quote` registers and
		 * which now exports and erases those three fields too. But the code may
		 * not say one thing and do another, so it says this instead.
		 */
		if ( ! in_array( 'attribution', $granted, true ) ) {
			self::forget_source();
		}

		wp_safe_redirect( self::back_to( $back, false ), 303 );
		exit;
	}

	/**
	 * Whether this POST was sent from a page of this shop.
	 *
	 * @return bool False when we cannot tell, which is a refusal.
	 */
	private static function same_origin(): bool {
		$ours = (string) wp_parse_url( home_url(), PHP_URL_SCHEME ) . '://'
			. (string) wp_parse_url( home_url(), PHP_URL_HOST );
		$port = wp_parse_url( home_url(), PHP_URL_PORT );
		if ( $port ) {
			$ours .= ':' . (int) $port;
		}

		$origin = isset( $_SERVER['HTTP_ORIGIN'] ) ? esc_url_raw( wp_unslash( $_SERVER['HTTP_ORIGIN'] ) ) : '';
		if ( '' !== $origin ) {
			return untrailingslashit( $origin ) === untrailingslashit( $ours );
		}

		/*
		 * No `Origin`. A handful of browsers still omit it on a same-origin form
		 * POST, so the referring HOST is the fallback, compared whole. Not the
		 * whole Referer, because a path can be anything; the host is the claim.
		 */
		$referer = isset( $_SERVER['HTTP_REFERER'] ) ? esc_url_raw( wp_unslash( $_SERVER['HTTP_REFERER'] ) ) : '';
		if ( '' !== $referer ) {
			return (string) wp_parse_url( $referer, PHP_URL_HOST ) === (string) wp_parse_url( home_url(), PHP_URL_HOST );
		}

		return false;
	}

	/**
	 * Where to send the visitor back to, on this site.
	 *
	 * `$reopen` reopens the panel, which is what a refused submission needs: the
	 * visitor pressed a button and something has to happen, and dropping them on
	 * a page with the banner already dismissed would look like it worked.
	 */
	private static function back_to( string $back, bool $reopen ): string {
		/*
		 * THE FLAG IS DROPPED FIRST (DON-04). The panel opened from the footer
		 * sits on `?cookies=1`, that URL is the return field, and sending a
		 * recorded choice back to it reopened the panel after every save: the
		 * visitor who withdrew saw the same question again and had every reason
		 * to think the withdrawal had not been taken.
		 */
		$url = remove_query_arg( 'cookies', '' !== $back ? $back : home_url( '/' ) );
		return $reopen ? add_query_arg( 'cookies', '1', $url ) . '#ts-consent' : $url;
	}

	/** @param string[] $granted */
	private static function write( array $granted ): void {
		$value = sprintf(
			'v%d:%s:%s',
			self::VERSION,
			gmdate( 'Y-m-d' ),
			implode( ',', array_values( array_unique( $granted ) ) )
		);

		self::$read   = true;
		self::$choice = $granted;

		setcookie(
			self::COOKIE,
			$value,
			array(
				'expires'  => time() + self::KEEP,
				'path'     => COOKIEPATH ? COOKIEPATH : '/',
				'domain'   => COOKIE_DOMAIN,
				'secure'   => is_ssl(),
				'httponly' => true,
				'samesite' => 'Lax',
			)
		);
	}

	// -----------------------------------------------------------------------
	// The thing the gate gates
	// -----------------------------------------------------------------------

	/**
	 * Remember where this visit came from, once, and only if allowed.
	 *
	 * WHAT IS STORED, in full, because a privacy policy has to be able to
	 * describe it: the path of the page the visitor was on when the cookie was
	 * written, the HOST of the referring site, and the campaign arguments if the
	 * URL carried any. No identifier, no IP, no timestamp beyond the date, and
	 * nothing that survives thirteen months.
	 *
	 * NO QUERY STRING FROM THE PATH. A visitor can arrive on a search URL, and
	 * `/?s=commande+pour+dupont+sarl` copied into a prospect record is personal
	 * data nobody meant to collect.
	 */
	public static function remember_source(): void {
		/*
		 * A REST CALL IS NOT AN ARRIVAL. The block cart talks to
		 * `/wp-json/wc/store/v1/cart` on `init` like everything else, and that
		 * path was being frozen as "the page you arrived on" and then copied onto
		 * a prospect record. Measured: a quote request carrying
		 * `_ts_src_page = /wp-json/wc/store/v1/cart`, which tells the associate
		 * nothing and tells the prospect something odd if they ask for their data.
		 */
		if ( is_admin() || wp_doing_ajax() || wp_doing_cron() ) {
			return;
		}
		if ( ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( function_exists( 'wp_is_json_request' ) && wp_is_json_request() ) ) {
			return;
		}
		if ( ! self::granted( 'attribution' ) || isset( $_COOKIE[ self::SOURCE_COOKIE ] ) ) {
			return;
		}

		$here = self::here();
		self::write_source( $here['page'], $here['referent'], $here['campagne'] );
	}

	/**
	 * What this request says about where the visitor came from.
	 *
	 * Read from the request being handled, so it stores nothing to obtain it.
	 * Two callers: `remember_source()` writes it when attribution is already
	 * allowed, and `render()` carries it on the banner so that a consent given
	 * on the LANDING page records the arrival rather than the page the visitor
	 * happened to be on afterwards.
	 *
	 * @return array{page:string,referent:string,campagne:string}
	 */
	private static function here(): array {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- reading the shape of a public request.
		$path = (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '/' ), PHP_URL_PATH );
		$ref  = (string) wp_parse_url( (string) ( $_SERVER['HTTP_REFERER'] ?? '' ), PHP_URL_HOST );

		$campaign = '';
		foreach ( array( 'utm_source', 'utm_medium', 'utm_campaign' ) as $key ) {
			if ( isset( $_GET[ $key ] ) && is_scalar( $_GET[ $key ] ) ) {
				$campaign .= ( '' === $campaign ? '' : '/' ) . sanitize_key( wp_unslash( $_GET[ $key ] ) );
			}
		}
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		// Our own host is not a referrer worth keeping: it just says the visitor
		// clicked a link on our site, which every internal page view does.
		if ( '' !== $ref && $ref === (string) wp_parse_url( home_url(), PHP_URL_HOST ) ) {
			$ref = '';
		}

		return array(
			'page'     => $path,
			'referent' => $ref,
			'campagne' => $campaign,
		);
	}

	/**
	 * Store the three fields, bounded, once.
	 *
	 * Shared by `record()`, which captures them at the moment of consent from
	 * the page the banner was rendered on, and by `remember_source()`, which
	 * fills the gap on a later visit whose cookie has expired. Two callers, one
	 * writer, because a cookie written two ways is a cookie read wrong once.
	 */
	private static function write_source( string $path, string $ref, string $campaign ): void {
		if ( isset( $_COOKIE[ self::SOURCE_COOKIE ] ) ) {
			return;
		}

		$value = implode(
			'|',
			array(
				substr( sanitize_text_field( $path ), 0, 120 ),
				substr( sanitize_text_field( $ref ), 0, 80 ),
				substr( sanitize_text_field( $campaign ), 0, 120 ),
			)
		);

		setcookie(
			self::SOURCE_COOKIE,
			$value,
			array(
				'expires'  => time() + self::KEEP,
				'path'     => COOKIEPATH ? COOKIEPATH : '/',
				'domain'   => COOKIE_DOMAIN,
				'secure'   => is_ssl(),
				'httponly' => true,
				'samesite' => 'Lax',
			)
		);
		$_COOKIE[ self::SOURCE_COOKIE ] = $value;
	}

	/**
	 * Drop `teeshoop_src` when nothing is entitled to read it.
	 *
	 * Public because it is a hook. The condition is deliberately `! granted()`
	 * and not `version mismatch`: an expired choice cookie, a refusal, a
	 * hand-edited cookie and a version bump all leave the same state, which is a
	 * source cookie no code may read, and the answer to all four is the same.
	 */
	public static function forget_stale_source(): void {
		if ( is_admin() || wp_doing_cron() || headers_sent() ) {
			return;
		}
		if ( ! isset( $_COOKIE[ self::SOURCE_COOKIE ] ) || self::granted( 'attribution' ) ) {
			return;
		}
		self::forget_source();
	}

	private static function forget_source(): void {
		setcookie(
			self::SOURCE_COOKIE,
			'',
			array(
				'expires' => time() - YEAR_IN_SECONDS,
				'path'    => COOKIEPATH ? COOKIEPATH : '/',
				'domain'  => COOKIE_DOMAIN,
			)
		);
		unset( $_COOKIE[ self::SOURCE_COOKIE ] );
	}

	/**
	 * Where this visit came from, for whoever is allowed to ask.
	 *
	 * @return array{page:string,referent:string,campagne:string}
	 */
	public static function source(): array {
		$empty = array(
			'page'     => '',
			'referent' => '',
			'campagne' => '',
		);
		if ( ! self::granted( 'attribution' ) || ! isset( $_COOKIE[ self::SOURCE_COOKIE ] ) ) {
			return $empty;
		}
		$parts = explode( '|', sanitize_text_field( wp_unslash( $_COOKIE[ self::SOURCE_COOKIE ] ) ), 3 );
		return array(
			'page'     => $parts[0] ?? '',
			'referent' => $parts[1] ?? '',
			'campagne' => $parts[2] ?? '',
		);
	}

	// -----------------------------------------------------------------------
	// What a visitor sees
	// -----------------------------------------------------------------------

	/** Whether the banner has to be shown at all. */
	public static function pending(): bool {
		return null === self::choice() && ! empty( self::offered() );
	}

	/**
	 * The banner, or the panel when the visitor asked to change their mind.
	 *
	 * IT IS NOT A WALL. The page underneath is fully readable and fully usable
	 * with the banner open, because the CNIL is explicit that access to a site
	 * may not be conditioned on accepting trackers for a purpose like this one,
	 * and because a shop that hides its own catalogue behind a dialogue loses
	 * the visitor it just paid to attract.
	 */
	public static function render(): void {
		static $printed = false;
		if ( $printed ) {
			return;
		}
		$open = self::panel_requested();
		if ( ! $open && ! self::pending() ) {
			return;
		}

		$categories = array_filter( self::categories(), static fn( array $c ): bool => $c['offered'] );
		if ( empty( $categories ) ) {
			return;
		}
		$printed = true;

		$granted = self::choice() ?? array();
		$back    = self::current_url();

		?>
		<section class="ts-consent" role="region" aria-labelledby="ts-consent-title" id="ts-consent">
			<form class="ts-consent__box" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>">
				<input type="hidden" name="retour" value="<?php echo esc_attr( $back ); ?>">
				<?php
				/*
				 * The referring host and the campaign of THIS page load, carried
				 * so that a consent given on the landing page records where the
				 * visit came from. Read only when attribution is granted; see
				 * `record()` for why they cannot be read on the next request.
				 */
				$ts_here = self::here();
				?>
				<input type="hidden" name="src_ref" value="<?php echo esc_attr( $ts_here['referent'] ); ?>">
				<input type="hidden" name="src_camp" value="<?php echo esc_attr( $ts_here['campagne'] ); ?>">
				<?php wp_nonce_field( self::ACTION ); ?>

				<h2 class="ts-consent__title" id="ts-consent-title">
					<?php esc_html_e( 'Une seule chose à décider', 'teeshoop' ); ?>
				</h2>

				<p class="ts-consent__lead">
					<?php
					/*
					 * THIS SENTENCE HAS TO BE TRUE, AND FOR FOUR SESSIONS IT WAS
					 * NOT. It promised that nothing was written before a choice
					 * while WooCommerce's sourcebuster was writing seven cookies
					 * on the same page load. The gate above now makes the promise
					 * true; `scripts/consent-verify.mjs` is what keeps it true,
					 * because a sentence is not a mechanism.
					 */
					esc_html_e( 'Le site fonctionne à l’identique quelle que soit votre réponse. Rien n’est enregistré sur votre appareil tant que vous n’avez pas choisi, en dehors de ce qui fait marcher le panier.', 'teeshoop' );
					?>
				</p>

				<ul class="ts-consent__list">
					<?php foreach ( $categories as $ts_key => $ts_cat ) : ?>
						<li class="ts-consent__item">
							<label class="ts-consent__label">
								<input
									type="checkbox"
									name="categories[]"
									value="<?php echo esc_attr( $ts_key ); ?>"
									<?php checked( in_array( $ts_key, $granted, true ) ); ?>
								>
								<span class="ts-consent__name"><?php echo esc_html( $ts_cat['label'] ); ?></span>
							</label>
							<details class="ts-consent__why">
								<summary><?php esc_html_e( 'Ce que cela veut dire exactement', 'teeshoop' ); ?></summary>
								<p class="ts-consent__detail"><?php echo esc_html( $ts_cat['detail'] ); ?></p>
							</details>
						</li>
					<?php endforeach; ?>
				</ul>

				<?php
				/*
				 * THE TWO BUTTONS ARE THE SAME BUTTON, TWICE.
				 *
				 * Same element, same class, same size, same weight, side by
				 * side, refuse first. The CNIL's grievance against the sites it
				 * has fined is not that refusing was impossible, it is that it
				 * took more clicks or read as the lesser option. The third
				 * control saves whatever is ticked above and is deliberately
				 * quieter than both, because it is the one that needs reading.
				 */
				?>
				<div class="ts-consent__acts">
					<button class="ts-consent__btn" type="submit" name="rien" value="1">
						<?php esc_html_e( 'Tout refuser', 'teeshoop' ); ?>
					</button>
					<button class="ts-consent__btn" type="submit" name="tout" value="1">
						<?php esc_html_e( 'Tout accepter', 'teeshoop' ); ?>
					</button>
					<button class="ts-consent__save" type="submit" name="choisi" value="1">
						<?php esc_html_e( 'Enregistrer mes choix', 'teeshoop' ); ?>
					</button>
				</div>

				<?php
				/*
				 * THE SLUG COMES FROM `Pages`, WHICH OWNS IT. It was typed here,
				 * and typed again in the theme footer, and a third answer lived in
				 * WordPress's own privacy-page option: three mechanisms looking
				 * for one document in three places is how they come to disagree.
				 */
				$ts_policy = class_exists( '\Teeshoop\Core\Pages' ) ? ( Pages::live()[ Pages::CONFIDENTIALITE ] ?? '' ) : '';
				if ( '' !== $ts_policy ) :
					?>
					<p class="ts-consent__more">
						<a href="<?php echo esc_url( $ts_policy ); ?>">
							<?php esc_html_e( 'Ce que nous enregistrons, en détail', 'teeshoop' ); ?>
						</a>
					</p>
				<?php endif; ?>
			</form>
		</section>
		<?php
	}

	/**
	 * The permanent way back to this decision, for the footer.
	 *
	 * A link and not a script: it adds a flag to the current URL, the page
	 * reloads, and `render()` opens the panel. Withdrawal has to work on the
	 * same terms as consent, which means without JavaScript.
	 */
	public static function reopen_url(): string {
		return add_query_arg( 'cookies', '1', self::current_url() ) . '#ts-consent';
	}

	private static function panel_requested(): bool {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a navigation flag; nothing is written.
		return ! empty( $_GET['cookies'] );
	}

	/**
	 * This page's own URL, on this site, QUERY STRING INCLUDED.
	 *
	 * IT USED TO DROP THE QUERY STRING and that broke a payment. This value is
	 * the banner's return field and the footer control's target, both rendered
	 * on every page including `/checkout/order-pay/{id}/?key=wc_order_…`. A
	 * customer who opened the pay link from their email and pressed « Tout
	 * refuser » was returned to the same path without the key, and WooCommerce
	 * answered « Désolé, cette commande est invalide et ne peut être finalisée ».
	 * The link only existed in their inbox. Measured on order 112920 of the
	 * mirror. The same loss threw away ten facets and the sort on a listing.
	 *
	 * The reasoning that produced the bug is written in `remember_source()` and
	 * it is correct THERE: `/?s=commande pour dupont sarl` must not be copied
	 * onto a prospect record. Nothing is stored here. This is where the visitor
	 * was, and sending them back to a different page is the failure.
	 */
	private static function current_url(): string {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading the request path.
		$uri  = (string) ( $_SERVER['REQUEST_URI'] ?? '/' );
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		$args = (string) wp_parse_url( $uri, PHP_URL_QUERY );

		$url = home_url( '' === $path ? '/' : $path );
		return '' === $args ? $url : $url . '?' . $args;
	}
}
