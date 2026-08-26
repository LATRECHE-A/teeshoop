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
 * THE ADVERTISING CATEGORY IS DECLARED AND NOT OFFERED. No Google Ads or Meta
 * tag id is configured, so asking a visitor to consent to a tag that does not
 * exist would be collecting a permission for nothing. It appears in the panel
 * the day an id is stored, and `scripts/seo-verify.mjs` checks both states.
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
	 */
	private const VERSION = 1;

	/** How long a choice is kept, seconds. The CNIL's ceiling is 13 months. */
	private const KEEP = 13 * 30 * DAY_IN_SECONDS;

	/** The form action, and the only way a choice is recorded. */
	public const ACTION = 'teeshoop_consentement';

	/** Option holding the advertising tag id, when there is one. */
	public const OPTION_TAGS = 'teeshoop_tags';

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

		add_action( 'wp_footer', array( self::class, 'render' ), 20 );
	}

	// -----------------------------------------------------------------------
	// The categories
	// -----------------------------------------------------------------------

	/**
	 * What we would like to do, in the visitor's terms, and whether we can.
	 *
	 * `offered` is false for a purpose that has nothing behind it today. A
	 * checkbox for an advertising tag that is not installed asks somebody to
	 * decide about a thing that does not exist, and the permission would sit
	 * there waiting for a tag nobody reviewed.
	 *
	 * @return array<string,array{label:string,detail:string,offered:bool}>
	 */
	public static function categories(): array {
		$tags = get_option( self::OPTION_TAGS, array() );
		$tags = is_array( $tags ) ? array_filter( $tags, static fn( $v ): bool => '' !== trim( (string) $v ) ) : array();

		return array(
			'attribution' => array(
				'label'   => __( 'Savoir par quelle page vous êtes arrivé', 'teeshoop' ),
				'detail'  => __( 'Un identifiant est enregistré sur votre appareil pour rattacher votre demande de devis à la page qui vous a amené ici. Cela nous dit quelles pages servent à quelque chose. Refuser n’enlève rien au site.', 'teeshoop' ),
				'offered' => true,
			),
			'publicite'   => array(
				'label'   => __( 'Mesurer nos campagnes publicitaires', 'teeshoop' ),
				'detail'  => __( 'Un marqueur fourni par une régie publicitaire, chargé uniquement si vous l’acceptez.', 'teeshoop' ),
				'offered' => ! empty( $tags ),
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

	/** The date the current choice was made, or '' when there is none. */
	public static function decided_on(): string {
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
		check_admin_referer( self::ACTION );

		$granted = array();
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- checked above.
		if ( isset( $_POST['tout'] ) ) {
			$granted = self::offered();
		} elseif ( ! isset( $_POST['rien'] ) ) {
			$raw = isset( $_POST['categories'] ) && is_array( $_POST['categories'] )
				? array_map( 'sanitize_key', array_filter( wp_unslash( $_POST['categories'] ), 'is_scalar' ) )
				: array();
			$granted = array_values( array_intersect( $raw, self::offered() ) );
		}
		$back = isset( $_POST['retour'] ) ? esc_url_raw( wp_unslash( $_POST['retour'] ) ) : '';
		// phpcs:enable WordPress.Security.NonceVerification.Missing

		self::write( $granted );

		/*
		 * WITHDRAWING A PERMISSION DELETES WHAT IT ALLOWED.
		 *
		 * A visitor who turns attribution off and keeps the identifier we wrote
		 * while it was on has not withdrawn anything. The cookie goes in the
		 * same response as the new choice.
		 */
		if ( ! in_array( 'attribution', $granted, true ) ) {
			self::forget_source();
		}

		wp_safe_redirect( '' !== $back ? $back : home_url( '/' ), 303 );
		exit;
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
		if ( is_admin() || wp_doing_ajax() || wp_doing_cron() ) {
			return;
		}
		if ( ! self::granted( 'attribution' ) || isset( $_COOKIE[ self::SOURCE_COOKIE ] ) ) {
			return;
		}

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

		$value = implode(
			'|',
			array(
				substr( sanitize_text_field( $path ), 0, 120 ),
				substr( sanitize_text_field( $ref ), 0, 80 ),
				substr( $campaign, 0, 120 ),
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
		$open = self::panel_requested();
		if ( ! $open && ! self::pending() ) {
			return;
		}

		$categories = array_filter( self::categories(), static fn( array $c ): bool => $c['offered'] );
		if ( empty( $categories ) ) {
			return;
		}

		$granted = self::choice() ?? array();
		$back    = self::current_url();

		?>
		<section class="ts-consent" role="region" aria-labelledby="ts-consent-title" id="ts-consent">
			<form class="ts-consent__box" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>">
				<input type="hidden" name="retour" value="<?php echo esc_attr( $back ); ?>">
				<?php wp_nonce_field( self::ACTION ); ?>

				<h2 class="ts-consent__title" id="ts-consent-title">
					<?php esc_html_e( 'Une seule chose à décider', 'teeshoop' ); ?>
				</h2>

				<p class="ts-consent__lead">
					<?php esc_html_e( 'Le site fonctionne à l’identique quelle que soit votre réponse. Rien n’est enregistré sur votre appareil tant que vous n’avez pas choisi, en dehors de ce qui fait marcher le panier.', 'teeshoop' ); ?>
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
							<p class="ts-consent__detail"><?php echo esc_html( $ts_cat['detail'] ); ?></p>
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
				$ts_policy = get_page_by_path( 'confidentialite' );
				if ( $ts_policy instanceof \WP_Post && 'publish' === $ts_policy->post_status ) :
					?>
					<p class="ts-consent__more">
						<a href="<?php echo esc_url( (string) get_permalink( $ts_policy ) ); ?>">
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

	/** This page's own URL, on this site, with no query string carried over. */
	private static function current_url(): string {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading the request path.
		$path = (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '/' ), PHP_URL_PATH );
		return home_url( '' === $path ? '/' : $path );
	}
}
