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
 * SELLING prices (what the shop charges) and never a purchase cost, a supplier
 * name or a film rate. That distinction is the whole reason the admin bundle was
 * split out of the customer one; it holds here too.
 *
 * `/cart` requires the WordPress REST nonce. The studio itself cannot send one:
 * it runs cross-origin in an iframe and has no access to the cookie. It posts a
 * message to the parent page instead, and the parent page (same origin, holding
 * the nonce) makes this call. THAT IS NO LONGER TRUE OF THE CUSTOMER PATH: the
 * editor is in the page since 5 September 2026 (includes/Editeur.php), holds the
 * nonce itself and calls this route directly. The paragraph is kept because the
 * REASON it states has not changed: this route requires the nonce explicitly,
 * because WordPress only refuses a BAD cookie nonce and never a missing one.
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
					/*
					 * A shorthand for "N printed sides at the standard area
					 * tier", which is exactly what the product page's estimator
					 * asks about and what every cell of the grid means.
					 *
					 * It exists so a browser never has to know the convention.
					 * Left to build `sides` itself, product.js would have to
					 * send the magic small area that lands in the first tier,
					 * and the day a tier boundary moved, a cached script would
					 * go on quoting the old one.
					 */
					'faces'   => array(
						'type'    => 'integer',
						'default' => 0,
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
	 * all: `rest_cookie_check_errors` only complains when a cookie is present.
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

	/** GET /quote: the price, and the breakdown behind it. */
	public static function quote( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$garment = (string) $request->get_param( 'garment' );
		$sides   = Design::normalise_sides( $request->get_param( 'sides' ) );

		// `faces` is the shorthand; explicit sides win, because a caller that
		// sent measured areas means them.
		$faces = (int) $request->get_param( 'faces' );
		if ( empty( $sides ) && $faces > 0 ) {
			$sides = Pricing::standard_sides( min( $faces, Garments::printable_sides_count( $garment ) ) );
		}

		try {
			$quote = Pricing::quote(
				array(
					'garment' => $garment,
					'qty'     => (int) $request->get_param( 'qty' ),
					'sides'   => $sides,
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

	/** GET /grid: faces × quantity, the table shown before the editor opens. */
	public static function grid( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$config  = Settings::pricing();
		$garment = (string) $request->get_param( 'garment' );

		/*
		 * The columns are DERIVED, and they are derived in one place.
		 *
		 * This route used to hold its own list of round quantities while the
		 * product page held another. Two lists of columns over one price engine
		 * is how a customer ends up comparing a page against an API answer and
		 * finding a break the other does not show. `Pricing::grid_qtys` is now
		 * the only thing that decides, here and in ProductPage.
		 */
		$qtys  = Pricing::grid_qtys( $config );
		$sides = range( 1, Garments::printable_sides_count( $garment ) );

		try {
			$grid = Pricing::grid( $garment, $qtys, $sides, $config );
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
				'garment'         => $garment,
				'currency'        => $config['currency'],
				'vat_rate'        => $config['vat_rate'],
				'qtys'            => $qtys,
				'std_area_sq_cm'  => Pricing::std_area_sq_cm( $config ),
				'rows'            => $grid,
			)
		);
	}

	/**
	 * POST /cart: add a personalised line.
	 *
	 * Note what is NOT read from the request: any price. The body carries what
	 * the customer chose; the server decides what it costs.
	 */
	public static function add_to_cart( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		if ( ! function_exists( 'WC' ) ) {
			return new \WP_Error( 'teeshoop_no_cart', __( 'Le panier n’est pas disponible.', 'teeshoop' ), array( 'status' => 503 ) );
		}

		/*
		 * THERE IS NO CART IN A REST REQUEST UNTIL SOMEBODY LOADS ONE.
		 *
		 * WooCommerce only builds a session and a cart for what it calls a
		 * frontend request, and `WooCommerce::is_rest_api_request()` decides
		 * that by looking for the REST prefix in `REQUEST_URI`. On a shop with
		 * PRETTY permalinks this route is `/wp-json/teeshoop/v1/cart`, which
		 * contains `wp-json`, so `WC()->cart` is null and every add-to-cart
		 * answered 503.
		 *
		 * It went unnoticed because the local mirror shipped with PLAIN
		 * permalinks, where the same route is `/index.php?rest_route=/teeshoop/v1/cart`
		 * and the prefix never appears in the URI: WooCommerce classified it as
		 * a frontend request, loaded a cart, and the whole buy flow verified
		 * green against a configuration production does not have. teeshoop.com
		 * runs pretty permalinks. Found on 2026-08-14, the first time the mirror
		 * was provisioned to match.
		 *
		 * `wc_load_cart()` is WooCommerce's own documented answer for exactly
		 * this (it is what the Store API and WP-CLI use), and it reads the
		 * visitor's session cookie, so what gets loaded is the caller's own
		 * basket and not a fresh one.
		 */
		if ( ! WC()->cart && function_exists( 'wc_load_cart' ) ) {
			wc_load_cart();
		}

		if ( ! WC()->cart ) {
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
				/*
				 * LA MATRICE, ET SON ABSENCE ICI A COÛTÉ 44 VÊTEMENTS SUR 51.
				 *
				 * `Cart::add` la lit depuis le 9 septembre 2026, l'éditeur
				 * l'envoie, et cette liste ne la recopiait pas. Un corps portant
				 * trois coloris arrivait donc dans `Cart::add` sans matrice, le
				 * repli d'avant la matrice reversait TOUTES les pièces sur le
				 * coloris de la création, et la boutique achetait, pressait et
				 * vérifiait la disponibilité d'articles que personne n'avait
				 * commandés. Mesuré sur le miroir avec le corps exact que
				 * `ajouterAuPanier` envoie : 7 blancs demandés en M, 13 noirs en
				 * L et 31 rouges en XL sont devenus 51 blancs.
				 *
				 * INVISIBLE À LA SUITE D'INTÉGRATION parce que chacun de ses cas
				 * appelle `Cart::add()` directement. C'est la couture entre du
				 * code juste et WooCommerce, exactement là où ce projet a déjà
				 * perdu de l'argent une fois, et la leçon est la même : ce qui
				 * n'est pas traversé par un test n'est pas vérifié.
				 */
				'matrix'     => $body['matrix'] ?? array(),
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
