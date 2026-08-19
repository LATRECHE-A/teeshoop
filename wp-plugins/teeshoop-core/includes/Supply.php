<?php
/**
 * Where the catalogue comes from.
 *
 * The shop does not talk to the supplier. It talks to OUR Worker, which holds
 * the supplier credentials, speaks the supplier's XML and CSV, and hands back
 * compact JSON. That is not a preference, it is the only way to have one
 * implementation: the Worker's parser encodes a dozen places where the
 * supplier's documentation and the supplier's actual responses disagree, and
 * every one of them was found by running against the live account. A second
 * parser in PHP would be a second set of those decisions, and it would drift.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS EXEMPTED IN scripts/php-guard.mjs
 *
 * It contains the catalogue route's path, which the guard treats as naming the
 * supplier. The exemption names THAT ONE STRING and nothing else: this file
 * cannot name the supplier, cannot print a purchase price and cannot reach the
 * cost engine without the guard failing, because "allowed to know the route"
 * must not quietly become "allowed to say who is at the end of it". Nothing
 * here renders to a browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TOKEN IS A CONSTANT, NOT AN OPTION
 *
 * `TEESHOOP_CATALOGUE_TOKEN` in wp-config.php. Not `wp_options`, for three
 * reasons that all bite on a real shop: options are dumped by every backup and
 * every migration plugin, they are editable by anyone who reaches the admin,
 * and they show up in `wp option list`. The token opens a route that returns
 * our purchase prices for the whole catalogue.
 *
 * FAIL CLOSED. No URL or no token means the importer refuses to run and says
 * which one is missing. It never falls back to "import without prices", because
 * a catalogue written with every cost blank looks exactly like a successful
 * import until someone tries to reorder.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

/*
 * `TEESHOOP_TEST` joins the guard because `Purchase::TRANSMITTABLE` names
 * `Supply::SOURCE`, and the pure test runner loads `Purchase.php`. The adapter
 * code has ONE home and the constant is it; copying the string into the other
 * class so this file could stay unloadable would be a second copy of exactly
 * the value the register exists to keep single.
 */
defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Supply {

	/** Where the catalogue lives on the Worker. */
	private const ROUTE = '/api/fr/';

	/**
	 * The adapter code every article this file imports is stamped with.
	 *
	 * A CODE, NOT A NAME, and the difference is enforced: `scripts/php-guard.mjs`
	 * keeps every supplier name out of this plugin, and `Catalogue::public_ref()`
	 * records what it cost when the procurement key leaked into a public product
	 * reference. What the shop needs in order to be second-sourced is not who is
	 * at the end of the route, it is WHICH ADAPTER wrote an article, so that two
	 * suppliers' articles can sit in one catalogue and a basket can refuse to
	 * mix them. `ws` is that: the adapter that speaks a webservice through the
	 * Worker. A second one gets a second code here and a second route, and
	 * nothing in `Purchase.php` changes.
	 */
	public const SOURCE = 'ws';

	/**
	 * Per-request deadline, seconds.
	 *
	 * The Worker's own upstream deadline is 10 s and its browse budget 18 s, so
	 * a style detail that is genuinely working answers well inside this. Longer
	 * than the Worker's own ceiling on purpose: whoever times out first decides
	 * what the operator is told, and the Worker can say WHAT broke.
	 */
	private const TIMEOUT = 40;

	/** Wall-clock ceiling for the catalogue walk, seconds. */
	private const LIST_TIMEOUT = 60;

	/**
	 * Articles per stock page.
	 *
	 * The Worker will serve up to twenty thousand in one answer and the whole
	 * snapshot is about forty-six thousand, so this is a shared-hosting choice
	 * rather than an upstream limit: a dozen small JSON responses WordPress can
	 * decode inside its memory limit, instead of three large ones a modest PHP
	 * would decode with nothing to spare on the day the catalogue grows.
	 */
	private const STOCK_PAGE = 4000;

	/**
	 * Is the shop configured to import at all?
	 *
	 * Returns '' when it is, or a sentence naming what is missing. Callers print
	 * it and stop; nothing here half-runs.
	 */
	public static function unconfigured(): string {
		if ( '' === self::base() ) {
			return 'L’adresse du Worker n’est pas réglée (réglage « worker_url »).';
		}
		if ( '' === self::token() ) {
			return 'Le jeton du catalogue est absent. Ajoutez define( \'TEESHOOP_CATALOGUE_TOKEN\', \'…\' ); dans wp-config.php.';
		}
		return '';
	}

	/** The Worker's base URL, without a trailing slash. */
	private static function base(): string {
		return rtrim( Settings::get( 'worker_url' ), '/' );
	}

	/**
	 * The shared secret. Constant only.
	 *
	 * A short value reads as unset, exactly as the Worker's own gate treats it:
	 * a four-character "secret" is not one, and letting it through would make
	 * every request fail with an unexplained 401.
	 */
	private static function token(): string {
		if ( ! defined( 'TEESHOOP_CATALOGUE_TOKEN' ) ) {
			return '';
		}
		$token = (string) constant( 'TEESHOOP_CATALOGUE_TOKEN' );
		return strlen( $token ) >= 24 ? $token : '';
	}

	/**
	 * Every reference the shop should carry, walked to the end.
	 *
	 * The catalogue endpoint pages by a resume offset rather than a page number,
	 * because it scans as far as its subrequest budget allows and then says
	 * where it stopped. Following `nextOffset` to null is the only way to know
	 * the list is complete, and knowing it is complete is what lets the importer
	 * tell "the supplier dropped this style" from "we stopped early".
	 *
	 * Returns ['ok'=>true,'refs'=>[...],'complete'=>bool] or ['ok'=>false,'error'=>string].
	 * `complete` false means DO NOT delist anything: we did not see the whole
	 * catalogue, so a reference we did not meet is not a reference that is gone.
	 *
	 * @param string $kind      'printable' (default), 'tee', 'polo', 'sweat', 'all'.
	 * @param int    $want      Stop once this many references are in hand. 0 = the
	 *                          whole catalogue. A smoke test asking for five
	 *                          references has no business scanning 2 316 styles,
	 *                          and a walk that does costs about a minute of
	 *                          supplier round trips before any work begins.
	 * @param int    $max_calls Safety stop. MEASURED: 11 calls for the whole
	 *                          catalogue once the Worker's block cache is warm,
	 *                          and about 65 when every block has to be built.
	 */
	public static function references( string $kind = 'printable', int $want = 0, int $max_calls = 200 ): array {
		$why = self::unconfigured();
		if ( '' !== $why ) {
			return array(
				'ok'    => false,
				'error' => $why,
			);
		}

		$refs     = array();
		$offset   = 0;
		$calls    = 0;
		$complete = false;
		$dropped  = 0;
		$started  = microtime( true );

		while ( $calls < $max_calls ) {
			$page = self::get(
				'styles',
				array(
					'kind'   => $kind,
					'limit'  => 48,
					'offset' => $offset,
				),
				self::LIST_TIMEOUT
			);
			++$calls;

			if ( ! $page['ok'] ) {
				// Partial is still useful: the caller imports what it saw and is
				// told the list is not complete, so nothing gets delisted on the
				// strength of a walk that fell over halfway.
				return array(
					'ok'       => ! empty( $refs ),
					'refs'     => array_values( array_unique( $refs ) ),
					'complete' => false,
					'error'    => $page['error'],
				);
			}

			$dropped += (int) ( $page['body']['dropped'] ?? 0 );

			foreach ( (array) ( $page['body']['items'] ?? array() ) as $card ) {
				$ref = isset( $card['styleNr'] ) ? (string) $card['styleNr'] : '';
				if ( preg_match( '/^\d{4,6}$/', $ref ) ) {
					$refs[] = $ref;
				}
			}

			/*
			 * Stopped short ON PURPOSE, and `complete` stays false.
			 *
			 * That flag is the single condition the delisting sweep checks, so a
			 * partial walk can never unpublish anything: a reference we did not
			 * meet is not a reference the supplier dropped.
			 */
			if ( $want > 0 && count( $refs ) >= $want ) {
				break;
			}

			$next = $page['body']['nextOffset'] ?? null;
			if ( null === $next ) {
				$complete = true;
				break;
			}
			$next = (int) $next;
			if ( $next <= $offset ) {
				// The endpoint would have us walk the same block for ever.
				break;
			}
			$offset = $next;
		}

		/*
		 * A LOSSY WALK IS NOT A COMPLETE ONE.
		 *
		 * The catalogue endpoint drops a style whose document it could not read
		 * and reports how many. In `items` that style is indistinguishable from
		 * one the supplier has withdrawn, and the only thing that reads
		 * `complete` is the sweep that UNPUBLISHES withdrawn references. One
		 * unreadable document must not cost a product that is on sale, so any
		 * drop demotes the walk to incomplete and nothing is delisted from it.
		 */
		if ( $dropped > 0 ) {
			$complete = false;
		}

		return array(
			'ok'       => true,
			'refs'     => array_values( array_unique( $refs ) ),
			'complete' => $complete,
			'dropped'  => $dropped,
			'calls'    => $calls,
			'seconds'  => round( microtime( true ) - $started, 1 ),
		);
	}

	/**
	 * One reference: detail, our prices and the stock, in a single request.
	 *
	 * Returns ['ok'=>true,'entry'=>array] or ['ok'=>false,'error'=>string].
	 */
	public static function entry( string $ref ): array {
		if ( ! preg_match( '/^\d{4,6}$/', $ref ) ) {
			return array(
				'ok'    => false,
				'error' => 'Référence mal formée : ' . $ref,
			);
		}
		$why = self::unconfigured();
		if ( '' !== $why ) {
			return array(
				'ok'    => false,
				'error' => $why,
			);
		}

		$res = self::get( 'catalogue/' . $ref, array(), self::TIMEOUT );
		if ( ! $res['ok'] ) {
			return array(
				'ok'    => false,
				'error' => $res['error'],
			);
		}
		if ( ! isset( $res['body']['style'] ) || ! is_array( $res['body']['style'] ) ) {
			return array(
				'ok'    => false,
				'error' => 'Réponse inattendue pour la référence ' . $ref . '.',
			);
		}

		return array(
			'ok'    => true,
			'entry' => $res['body'],
		);
	}

	/**
	 * One page of the whole catalogue's stock.
	 *
	 * ONE UPSTREAM CALL, WHATEVER THE PAGE. The Worker holds a snapshot of every
	 * article (`loadStockAll`) and serves slices of it, so a sweep of the whole
	 * catalogue costs the supplier one request and this shop a handful. The
	 * shape that would have been obvious, one request per reference, is 460
	 * round trips for a number that changes several times a day.
	 *
	 * `at` IS THE SUPPLIER'S OWN TIMESTAMP for the snapshot this page came from,
	 * and it is the reason this route exists in this shape. Chapter 05 of the
	 * brief: « Le stock affiché par une API n'est pas une garantie absolue. Le
	 * système doit enregistrer la date de consultation. » A quantity with no
	 * date behind it cannot be shown to anybody.
	 *
	 * @return array{ok:bool,error?:string,at?:string,total?:int,rows?:array,next?:?int}
	 */
	public static function stock_page( int $offset, int $limit = self::STOCK_PAGE ): array {
		$why = self::unconfigured();
		if ( '' !== $why ) {
			return array(
				'ok'    => false,
				'error' => $why,
			);
		}

		$res = self::get(
			'stock',
			array(
				'offset' => max( 0, $offset ),
				'limit'  => max( 1, min( 20000, $limit ) ),
			),
			self::TIMEOUT
		);
		if ( ! $res['ok'] ) {
			return array(
				'ok'    => false,
				'error' => $res['error'],
			);
		}

		$body = $res['body'];
		if ( ! isset( $body['rows'] ) || ! is_array( $body['rows'] ) || ! isset( $body['at'] ) ) {
			return array(
				'ok'    => false,
				'error' => 'Réponse de stock illisible.',
			);
		}

		/*
		 * A PAGE WITH NO TIMESTAMP IS REFUSED, not stored with an empty date.
		 * The date is what makes the quantity usable; an article whose freshness
		 * is blank reads on every screen as « nous ne savons pas », which is a
		 * safe answer and a wrong one when the supplier did tell us.
		 */
		if ( '' === trim( (string) $body['at'] ) ) {
			return array(
				'ok'    => false,
				'error' => 'Le fournisseur n’a pas daté ce relevé de stock.',
			);
		}

		return array(
			'ok'    => true,
			'at'    => (string) $body['at'],
			'total' => (int) ( $body['total'] ?? 0 ),
			'rows'  => $body['rows'],
			'next'  => isset( $body['nextOffset'] ) && null !== $body['nextOffset'] ? (int) $body['nextOffset'] : null,
		);
	}

	/**
	 * Is the supplier account a rehearsal or the real thing?
	 *
	 * `unknown` when we could not ask, and `unknown` is NOT a synonym for
	 * « probably test ». It is the state in which nothing may be sent: the whole
	 * confirmation this shop asks a human for is a comparison against this word,
	 * and confirming against a word nobody could read confirms nothing.
	 *
	 * @return array{mode:string,error:string,at:string}
	 */
	public static function mode(): array {
		$why = self::unconfigured();
		if ( '' !== $why ) {
			return array(
				'mode'  => 'unknown',
				'error' => $why,
				'at'    => '',
			);
		}
		$res = self::get( 'state', array(), 10 );
		if ( ! $res['ok'] ) {
			return array(
				'mode'  => 'unknown',
				'error' => (string) $res['error'],
				'at'    => '',
			);
		}
		$mode = (string) ( $res['body']['mode'] ?? '' );
		return array(
			'mode'  => in_array( $mode, array( 'test', 'live' ), true ) ? $mode : 'unknown',
			'error' => in_array( $mode, array( 'test', 'live' ), true ) ? '' : 'réponse inattendue',
			'at'    => (string) ( $res['body']['at'] ?? '' ),
		);
	}

	/**
	 * Place a supplier order. The only call in this plugin that spends money.
	 *
	 * ── IT IS NOT `self::get()` AND IT MUST NOT BECOME IT ────────────────────
	 *
	 * That helper retries once on a transport failure, which is right for an
	 * idempotent GET and catastrophic here: the first attempt may have arrived.
	 * This posts exactly once, and every failure mode that could mean « it may
	 * have arrived » comes back as `outcome => unknown` rather than as an error,
	 * so the caller records the doubt instead of resolving it by guessing.
	 *
	 * `$expect_mode` is the word the operator confirmed against. The Worker reads
	 * the account's real mode and refuses on a disagreement, before building
	 * anything.
	 *
	 * @param string $key         Our idempotency key, also the supplier's reference.
	 * @param string $expect_mode 'test' or 'live'.
	 * @param array  $lines       [['sku'=>string,'qty'=>int,'lineRef'=>string], …]
	 *
	 * @return array{outcome:string,ok:bool,orderId:string,message:string,lines:array,mode:array}
	 */
	public static function place_order( string $key, string $expect_mode, array $lines ): array {
		$unknown = static fn( string $why ): array => array(
			'outcome' => 'unknown',
			'ok'      => false,
			'orderId' => '',
			'message' => $why,
			'lines'   => array(),
			'mode'    => array(),
		);
		$refused = static fn( string $why ): array => array(
			'outcome' => 'rejected',
			'ok'      => false,
			'orderId' => '',
			'message' => $why,
			'lines'   => array(),
			'mode'    => array(),
		);

		$why = self::unconfigured();
		if ( '' !== $why ) {
			// Nothing was sent: the shop is not configured to send at all.
			return $refused( $why );
		}

		$response = wp_remote_post(
			self::base() . self::ROUTE . 'order',
			array(
				'timeout'     => self::TIMEOUT,
				'redirection' => 0,
				'headers'     => array(
					'content-type'  => 'application/json',
					'accept'        => 'application/json',
					'authorization' => 'Bearer ' . self::token(),
				),
				'body'        => (string) wp_json_encode(
					array(
						'idempotencyKey' => $key,
						'mode'           => $expect_mode,
						'partialShipment' => false,
						'note'           => 'Teeshoop ' . $key,
						'lines'          => array_values( $lines ),
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			/*
			 * A TRANSPORT FAILURE HERE IS AMBIGUOUS AND STAYS AMBIGUOUS. WordPress
			 * cannot tell a connection refused from a response lost after the
			 * Worker forwarded the document, and the Worker cannot tell a lost
			 * answer from an order the supplier never saw.
			 */
			return $unknown( 'Le Worker est injoignable : ' . $response->get_error_message() );
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$body = is_array( $body ) ? $body : array();

		if ( 200 === $code && isset( $body['outcome'] ) ) {
			return array(
				'outcome' => (string) $body['outcome'],
				'ok'      => ! empty( $body['ok'] ),
				'orderId' => (string) ( $body['orderId'] ?? '' ),
				'message' => (string) ( $body['message'] ?? '' ),
				'lines'   => is_array( $body['lines'] ?? null ) ? $body['lines'] : array(),
				'mode'    => is_array( $body['mode'] ?? null ) ? $body['mode'] : array(),
			);
		}

		/*
		 * EVERY REFUSAL THE WORKER MAKES BEFORE SENDING IS A REFUSAL, and it
		 * names them: 400 for a document it will not build, 401 for a token,
		 * 409 for a mode that moved, 503 for a customer number nobody has set.
		 * Anything else is a Worker that answered something we do not recognise,
		 * which cannot be told from a document that went out.
		 */
		$message = (string) ( $body['message'] ?? ( 'Le Worker a répondu ' . $code . '.' ) );
		if ( in_array( $code, array( 400, 401, 403, 409, 503 ), true ) ) {
			return $refused( $message );
		}
		return $unknown( $message );
	}

	/**
	 * One authenticated GET, retried once on a transport failure.
	 *
	 * Retried ONCE and only on a transport error or a 5xx: a 401 will not
	 * become a 200 by asking again, and a catalogue walk that retries every
	 * refusal three times turns a bad token into a twenty-minute hang.
	 */
	private static function get( string $path, array $query, int $timeout ): array {
		$url = self::base() . self::ROUTE . $path;
		if ( ! empty( $query ) ) {
			$url = add_query_arg( $query, $url );
		}

		$args = array(
			'timeout'     => $timeout,
			'redirection' => 0,
			'headers'     => array(
				'accept'        => 'application/json',
				'authorization' => 'Bearer ' . self::token(),
			),
		);

		for ( $attempt = 0; $attempt < 2; $attempt++ ) {
			$response = wp_remote_get( $url, $args );

			if ( is_wp_error( $response ) ) {
				if ( 0 === $attempt ) {
					continue;
				}
				return array(
					'ok'    => false,
					'error' => 'Le Worker est injoignable : ' . $response->get_error_message(),
				);
			}

			$code = (int) wp_remote_retrieve_response_code( $response );
			if ( 401 === $code ) {
				return array(
					'ok'    => false,
					'error' => 'Le Worker a refusé le jeton du catalogue (401).',
				);
			}
			if ( $code >= 500 && 0 === $attempt ) {
				continue;
			}
			if ( 200 !== $code ) {
				return array(
					'ok'    => false,
					'error' => 'Le Worker a répondu ' . $code . ' sur ' . $path . '.',
				);
			}

			$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
			if ( ! is_array( $body ) ) {
				return array(
					'ok'    => false,
					'error' => 'Réponse illisible du Worker sur ' . $path . '.',
				);
			}

			return array(
				'ok'   => true,
				'body' => $body,
			);
		}

		return array(
			'ok'    => false,
			'error' => 'Le Worker est injoignable.',
		);
	}
}
