<?php
/**
 * The REST surface: /wp-json/teeshoop/v1/*
 *
 * Three endpoints, two permission models.
 *
 *   GET  /quote   public   pure computation, no writes, no secrets
 *   GET  /grid    public   the price table on the product page
 *   POST /cart    nonce    mutates the caller's own cart
 *
 * `/quote` and `/grid` are public because the product page and the studio both
 * need a price before anyone has logged in or accepted a cookie. They return
 * SELLING prices — what the shop charges — and never a purchase cost, a supplier
 * name or a film rate. That distinction is the whole reason the admin bundle was
 * split out of the customer one; it holds here too.
 *
 * `/cart` requires the WordPress REST nonce. The studio itself cannot send one:
 * it runs cross-origin in an iframe and has no access to the cookie. It posts a
 * message to the parent page instead, and the parent page — same origin, holding
 * the nonce — makes this call. See assets/bridge.js.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Rest {

	private const NS = 'teeshoop/v1';

	public static function init(): void {
		add_action( 'rest_api_init', array( self::class, 'register' ) );
	}

	public static function register(): void {
		register_rest_route(
			self::NS,
			'/quote',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( self::class, 'quote' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'garment' => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_key',
					),
					'qty'     => array(
						'type'    => 'integer',
						'default' => 1,
					),
					'sides'   => array(
						'type'    => 'array',
						'default' => array(),
					),
				),
			)
		);

		register_rest_route(
			self::NS,
			'/grid',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( self::class, 'grid' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'garment' => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_key',
					),
				),
			)
		);

		register_rest_route(
			self::NS,
			'/cart',
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( self::class, 'add_to_cart' ),
				'permission_callback' => array( self::class, 'check_nonce' ),
			)
		);
	}

	/**
	 * The nonce check for /cart.
	 *
	 * WordPress verifies `X-WP-Nonce` itself and sets the current user from the
	 * cookie; what it does NOT do is refuse an anonymous caller with no nonce at
	 * all — `rest_cookie_check_errors` only complains when a cookie is present.
	 * So we require the nonce explicitly. Without it, any site on the internet
	 * could POST a line into a visitor's basket through their browser.
	 */
	public static function check_nonce( \WP_REST_Request $request ): bool|\WP_Error {
		$nonce = $request->get_header( 'x-wp-nonce' );
		if ( ! $nonce || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
			return new \WP_Error(
				'teeshoop_bad_nonce',
				__( 'Votre session a expiré. Rechargez la page, puis réessayez.', 'teeshoop' ),
				array( 'status' => 403 )
			);
		}
		return true;
	}

	/** GET /quote — the price, and the breakdown behind it. */
	public static function quote( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		try {
			$quote = Pricing::quote(
				array(
					'garment' => (string) $request->get_param( 'garment' ),
					'qty'     => (int) $request->get_param( 'qty' ),
					'sides'   => Design::normalise_sides( $request->get_param( 'sides' ) ),
				),
				Settings::pricing()
			);
		} catch ( \InvalidArgumentException $e ) {
			return new \WP_Error(
				'teeshoop_unknown_garment',
				__( 'Vêtement inconnu.', 'teeshoop' ),
				array( 'status' => 400 )
			);
		}

		return new \WP_REST_Response( self::as_euros( $quote ) );
	}

	/** GET /grid — faces × quantity, the table shown before the editor opens. */
	public static function grid( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$config = Settings::pricing();
		$qtys   = array( 1, 5, 10, 25, 50, 100 );
		$sides  = array( 1, 2 );

		try {
			$grid = Pricing::grid( (string) $request->get_param( 'garment' ), $qtys, $sides, $config );
		} catch ( \InvalidArgumentException $e ) {
			return new \WP_Error(
				'teeshoop_unknown_garment',
				__( 'Vêtement inconnu.', 'teeshoop' ),
				array( 'status' => 400 )
			);
		}

		foreach ( $grid as &$row ) {
			foreach ( $row['cells'] as &$cell ) {
				$cell['unit_ht_eur']  = Money::to_eur( $cell['unit_ht'] );
				$cell['unit_ttc_eur'] = Money::to_eur( $cell['unit_ttc'] );
			}
			unset( $cell );
		}
		unset( $row );

		return new \WP_REST_Response(
			array(
				'garment'  => (string) $request->get_param( 'garment' ),
				'currency' => $config['currency'],
				'vat_rate' => $config['vat_rate'],
				'rows'     => $grid,
			)
		);
	}

	/**
	 * POST /cart — add a personalised line.
	 *
	 * Note what is NOT read from the request: any price. The body carries what
	 * the customer chose; the server decides what it costs.
	 */
	public static function add_to_cart( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		if ( ! function_exists( 'WC' ) || ! WC()->cart ) {
			return new \WP_Error( 'teeshoop_no_cart', __( 'Le panier n’est pas disponible.', 'teeshoop' ), array( 'status' => 503 ) );
		}

		$body = $request->get_json_params();
		if ( ! is_array( $body ) ) {
			return new \WP_Error( 'teeshoop_bad_body', __( 'Requête incorrecte.', 'teeshoop' ), array( 'status' => 400 ) );
		}

		$key = Cart::add(
			array(
				'product_id' => (int) ( $body['product_id'] ?? 0 ),
				'qty'        => (int) ( $body['qty'] ?? 1 ),
				'garment'    => (string) ( $body['garment'] ?? '' ),
				'sides'      => $body['sides'] ?? array(),
				'design_id'  => (string) ( $body['design_id'] ?? '' ),
				'size_grid'  => $body['size_grid'] ?? array(),
			)
		);

		if ( is_wp_error( $key ) ) {
			return $key;
		}

		WC()->cart->calculate_totals();

		return new \WP_REST_Response(
			array(
				'ok'         => true,
				'item_key'   => $key,
				'cart_count' => WC()->cart->get_cart_contents_count(),
				'cart_url'   => wc_get_cart_url(),
				'total_ttc'  => WC()->cart->get_total( 'edit' ),
			),
			201
		);
	}

	/**
	 * Add euro floats alongside the cents.
	 *
	 * Cents are what the server computes with; euros are what a JavaScript client
	 * wants to print. Sending both means the client never divides by 100 itself
	 * and never invents a rounding of its own.
	 */
	private static function as_euros( array $quote ): array {
		foreach ( array( 'unit_ht', 'unit_ttc', 'total_ht', 'total_vat', 'total_ttc' ) as $key ) {
			$quote[ $key . '_eur' ] = Money::to_eur( $quote[ $key ] );
		}
		$quote['display'] = array(
			'unit_ht'   => Money::format( $quote['unit_ht'] ),
			'total_ht'  => Money::format( $quote['total_ht'] ),
			'total_ttc' => Money::format( $quote['total_ttc'] ),
		);
		return $quote;
	}
}
