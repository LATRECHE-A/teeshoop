<?php
/**
 * What carriage costs, what the customer is charged for it, and what we bear.
 *
 * THOSE ARE THREE DIFFERENT NUMBERS AND THE FILE EXISTS TO KEEP THEM APART.
 * The Bible is explicit that free delivery is a cost and not a marketing flag:
 * "Le coût direct comprend tout ce qui disparaît si la commande n'existe pas :
 * textile, marquage, transport fournisseur, emballage, livraison offerte …"
 * (chapter 1). So a basket over the franco threshold is charged 0 and still
 * costs the shop a parcel, and `quote()` returns both, so the cost engine of
 * session 05 can be handed the real figure rather than a zero.
 *
 * THE GRID IS LA POSTE'S PUBLIC ONE, and it is derived rather than negotiated.
 * Question 07 of QUESTIONS-ASSOCIE.md asks the associate for his real carrier
 * rates and its written default is "grille publique Colissimo". These nine
 * brackets were read on 18/08/2026 from La Poste's own 2026 tariff poster
 * ("PRINCIPAUX TARIFS COLIS DÉPART DE FRANCE MÉTROPOLITAINE, 1er janvier 2026")
 * and cross-checked against laposte.fr/tarif-colissimo. A Colissimo Entreprise
 * grid exists and is also public, but using it would claim a contract nobody
 * has signed, and at the weights this shop actually ships it is dearer anyway.
 *
 * THE PUBLIC GRID CARRIES NO VAT: postage inside the service universel is
 * exempt, which is why La Poste prints "tarifs nets" rather than HT or TTC.
 * Measured rather than assumed: the consumer page and the professional page
 * publish the same 5,49 EUR for a 250 g parcel, while the packaging products
 * beside it differ by exactly 20 %. What we then CHARGE a customer is a
 * different question: carriage billed on a sale of goods follows the goods'
 * own rate, so the figures here are HT and WooCommerce adds VAT on top under
 * the standard regime. We break even on the stamp; we do not profit from it.
 *
 * ABOVE ONE PARCEL WE REFUSE TO QUOTE, and that is not laziness. Colissimo
 * stops at 30 kg and at 150 cm of girth, and this shop knows the weight of a
 * garment but not its packed volume. Two hundred t-shirts are 36 kg, which is
 * two parcels by weight and about five by volume, so a two-parcel price would
 * be a number we invented and paid for. A basket that cannot be shipped in one
 * parcel is told to ask for a quote, which is the same door question 02 already
 * built for a run the site will not price alone.
 *
 * Pure by construction, except `init()` and the WooCommerce method it registers.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';

final class Shipping {

	/** The WooCommerce shipping method id. Stored on every order that used it. */
	public const METHOD_ID = 'teeshoop_colissimo';

	/** No rate: the basket is heavier than one parcel. */
	public const TOO_HEAVY = 'too_heavy';

	/** No rate: at least one line has no weight, so nothing can be weighed. */
	public const NO_WEIGHT = 'no_weight';

	/** No rate: we do not deliver there. */
	public const OFF_ZONE = 'off_zone';

	public static function default_config(): array {
		return array(
			/*
			 * Colissimo France domicile, public grid, in force 1 January 2026.
			 * Cents, and net of VAT because the postage itself carries none.
			 * `max_g` is inclusive: a parcel of exactly 250 g is 5,49 EUR.
			 */
			'grid'               => array(
				array( 'max_g' => 250, 'ht' => 549 ),
				array( 'max_g' => 500, 'ht' => 759 ),
				array( 'max_g' => 750, 'ht' => 929 ),
				array( 'max_g' => 1000, 'ht' => 959 ),
				array( 'max_g' => 2000, 'ht' => 1119 ),
				array( 'max_g' => 5000, 'ht' => 1739 ),
				array( 'max_g' => 10000, 'ht' => 2529 ),
				array( 'max_g' => 15000, 'ht' => 3199 ),
				array( 'max_g' => 30000, 'ht' => 3959 ),
			),

			/*
			 * Packaging, question 07's written default: "0,60 EUR d'emballage par
			 * pièce plus 1,50 EUR de carton".
			 *
			 * THE BIBLE'S ONE MEASUREMENT DISAGREES, and by a factor of two. Its
			 * worked example bills "emballage : 9 EUR" on a thirty-piece order,
			 * which is 0,30 EUR a piece, materials only, with no carton line at
			 * all. Neither figure is the associate's, and the difference on a run
			 * of fifty is 16,50 EUR against 15,00 EUR, so it is small in euros and
			 * worth saying out loud anyway: question 07 now names both.
			 */
			'packaging_piece_ht' => 60,
			'packaging_order_ht' => 150,

			/*
			 * What the packing itself weighs, and it is ZERO because nobody has
			 * weighed it.
			 *
			 * The grid brackets on "emballage et contenu compris", so a carton
			 * that weighs 400 g can push a parcel into the next bracket. Putting
			 * a plausible figure here would be inventing a number that decides
			 * what a customer pays for carriage. Zero errs against us: we under-
			 * bracket, absorb the difference, and never overcharge. Question 07
			 * now asks him to weigh a real carton.
			 */
			'packaging_piece_g'  => 0,
			'packaging_order_g'  => 0,

			/*
			 * Free delivery above this, in cents HT of goods.
			 *
			 * Question 07's default: "livraison offerte au-dessus de 300 EUR hors
			 * taxes". The Bible names no customer franco anywhere; the only
			 * `seuil de franco` in it is the textile SUPPLIER's, which is an input
			 * to our cost and not an offer to a buyer. 0 disables it, the same
			 * convention as every other threshold in this plugin.
			 */
			'free_from_ht'       => 30000,

			/*
			 * Where we deliver, question 35: "Français uniquement, livraison en
			 * France métropolitaine, autres pays traités sur devis manuel".
			 *
			 * The postcode prefixes are the DOM and the collectivités, which are
			 * inside country FR for WooCommerce and outside métropole for both
			 * the tariff and the VAT: Guadeloupe and Réunion are at 8,5 %, Guyane
			 * and Mayotte have no VAT at all, and none of them is on this grid.
			 * Quoting a métropole parcel to Cayenne would be wrong twice.
			 */
			'countries'          => array( 'FR' ),
			'excluded_postcodes' => array( '97', '98' ),
		);
	}

	/** Merge a stored partial over the shipped defaults, per top-level key. */
	public static function merge_config( array $stored ): array {
		$config = self::default_config();
		foreach ( $stored as $key => $value ) {
			if ( array_key_exists( $key, $config ) ) {
				$config[ $key ] = $value;
			}
		}
		return $config;
	}

	/**
	 * The grid row a parcel weight falls into, or null when nothing carries it.
	 *
	 * Null and not the last row. An unbounded fallback here would quote 39,59 EUR
	 * for a 90 kg pallet La Poste will not accept, and the customer would have
	 * paid for a delivery that cannot happen.
	 */
	public static function bracket( int $grams, array $config ): ?array {
		$best = null;
		foreach ( (array) $config['grid'] as $row ) {
			$max = (int) ( $row['max_g'] ?? 0 );
			if ( $grams <= $max && ( null === $best || $max < (int) $best['max_g'] ) ) {
				$best = $row;
			}
		}
		return $best;
	}

	/** The heaviest parcel the grid can price. */
	public static function max_parcel_g( array $config ): int {
		$max = 0;
		foreach ( (array) $config['grid'] as $row ) {
			$max = max( $max, (int) ( $row['max_g'] ?? 0 ) );
		}
		return $max;
	}

	/**
	 * Price one delivery.
	 *
	 * @param int  $goods_g   Weight of the garments alone, grams.
	 * @param int  $pieces    How many garments, for the per-piece packaging.
	 * @param int  $goods_ht  What the goods cost, cents HT, for the franco.
	 * @param bool $weighable  False when any line has no weight at all.
	 *
	 * @return array{ok:bool,reason:string,charged_ht:int,carrier_ht:int,packaging_ht:int,borne_ht:int,free:bool,parcel_g:int,bracket_g:int}
	 */
	public static function quote( int $goods_g, int $pieces, int $goods_ht, array $config, bool $weighable = true ): array {
		$pieces = max( 0, $pieces );

		$packaging = $pieces > 0
			? (int) $config['packaging_order_ht'] + $pieces * (int) $config['packaging_piece_ht']
			: 0;

		$parcel_g = max( 0, $goods_g )
			+ ( $pieces > 0 ? (int) $config['packaging_order_g'] + $pieces * (int) $config['packaging_piece_g'] : 0 );

		$refuse = static function ( string $reason ) use ( $packaging, $parcel_g ): array {
			return array(
				'ok'           => false,
				'reason'       => $reason,
				'charged_ht'   => 0,
				'carrier_ht'   => 0,
				// Reported even on a refusal: the packaging is bought the moment
				// the order is made, whether or not we found a way to ship it.
				'packaging_ht' => $packaging,
				'borne_ht'     => $packaging,
				'free'         => false,
				'parcel_g'     => $parcel_g,
				'bracket_g'    => 0,
			);
		};

		/*
		 * A LINE WITH NO WEIGHT IS NOT A LINE THAT WEIGHS NOTHING.
		 *
		 * WooCommerce returns 0 for a product whose weight was never set, so a
		 * personalisable product created by hand would silently ship in the
		 * 250 g bracket at 5,49 EUR whatever it really is. "We could not look"
		 * and "it is light" are different results, and only one of them may be
		 * charged for.
		 */
		if ( ! $weighable ) {
			return $refuse( self::NO_WEIGHT );
		}

		$bracket = self::bracket( $parcel_g, $config );
		if ( null === $bracket ) {
			return $refuse( self::TOO_HEAVY );
		}

		$carrier = (int) $bracket['ht'];
		$borne   = $carrier + $packaging;

		$free_from = (int) $config['free_from_ht'];
		$free      = $free_from > 0 && $goods_ht >= $free_from;

		return array(
			'ok'           => true,
			'reason'       => '',
			// What the customer pays. Zero above the franco, and the shop still
			// bought the parcel: `borne_ht` is what session 05 must subtract.
			'charged_ht'   => $free ? 0 : $borne,
			'carrier_ht'   => $carrier,
			'packaging_ht' => $packaging,
			'borne_ht'     => $borne,
			'free'         => $free,
			'parcel_g'     => $parcel_g,
			'bracket_g'    => (int) $bracket['max_g'],
		);
	}

	/**
	 * Whether we deliver to an address.
	 *
	 * An EMPTY postcode passes: WooCommerce asks for a shipping estimate before
	 * the customer has typed one, and refusing then would show "nous ne livrons
	 * pas chez vous" to someone who has not said where they are. The real gate is
	 * at checkout, where the postcode is required.
	 */
	public static function serves( string $country, string $postcode, array $config ): bool {
		$country = strtoupper( trim( $country ) );
		if ( '' !== $country && ! in_array( $country, (array) $config['countries'], true ) ) {
			return false;
		}

		$digits = preg_replace( '/\D/', '', $postcode ) ?? '';
		if ( '' === $digits ) {
			return true;
		}
		foreach ( (array) $config['excluded_postcodes'] as $prefix ) {
			if ( str_starts_with( $digits, (string) $prefix ) ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Why no rate was offered, for the customer, in French.
	 *
	 * A shipping selector with nothing in it and no sentence beside it is the
	 * single most abandoning thing a checkout can do. Each of these says what
	 * happened and what to do about it.
	 */
	public static function refusal_message( string $reason, array $config ): string {
		switch ( $reason ) {
			case self::TOO_HEAVY:
				return sprintf(
					/* translators: %s: a weight in kilograms. */
					__( 'Cette commande dépasse %s kg, soit un colis complet. Nous organisons la livraison à la main : demandez un devis et nous chiffrons le transport avec vous.', 'teeshoop' ),
					Money::number( self::max_parcel_g( $config ) / 1000, 0 )
				);
			case self::OFF_ZONE:
				return __( 'Nous livrons aujourd’hui en France métropolitaine. Pour les DOM, la Corse hors métropole ou l’étranger, demandez un devis : nous chiffrons le transport avec vous.', 'teeshoop' );
			case self::NO_WEIGHT:
			default:
				return __( 'Le poids d’un des articles du panier n’est pas renseigné, donc la livraison ne peut pas être calculée. Demandez un devis, nous chiffrons le transport à la main.', 'teeshoop' );
		}
	}

	// ── WordPress side ───────────────────────────────────────────────────────

	public static function init(): void {
		add_action( 'woocommerce_shipping_init', array( self::class, 'declare_method' ) );
		add_filter( 'woocommerce_shipping_methods', array( self::class, 'register_method' ) );
	}

	/** The stored grid merged over the shipped one. */
	public static function config(): array {
		$stored = get_option( OPTION_SHIPPING, array() );
		return self::merge_config( is_array( $stored ) ? $stored : array() );
	}

	/**
	 * Weigh a WooCommerce shipping package.
	 *
	 * Returns the garment weight in grams, the piece count, the goods total HT,
	 * and whether every line could actually be weighed.
	 *
	 * @return array{grams:int,pieces:int,goods_ht:int,weighable:bool,unweighed:string[]}
	 */
	public static function weigh( array $package ): array {
		$grams     = 0;
		$pieces    = 0;
		$unweighed = array();

		/*
		 * `contents_cost` and not a sum of line totals. WooCommerce builds it in
		 * `get_shipping_packages()` for exactly this purpose, excluding tax and
		 * excluding anything not shipped, and it is set before a method is asked
		 * to quote. Re-deriving it here would be a second implementation of the
		 * franco's own basis.
		 */
		$goods_ht = Money::from_eur( (string) ( $package['contents_cost'] ?? 0 ) );

		foreach ( (array) ( $package['contents'] ?? array() ) as $item ) {
			$product = $item['data'] ?? null;
			$qty     = (int) ( $item['quantity'] ?? 0 );
			$pieces += $qty;

			if ( ! $product instanceof \WC_Product ) {
				continue;
			}
			$weight = $product->get_weight();
			if ( '' === $weight || null === $weight || ! is_numeric( $weight ) || (float) $weight <= 0 ) {
				$unweighed[] = $product->get_name();
				continue;
			}
			// wc_get_weight normalises from the store's unit; the grid is grams.
			$grams += (int) round( (float) wc_get_weight( (float) $weight, 'g' ) * $qty );
		}

		return array(
			'grams'     => $grams,
			'pieces'    => $pieces,
			'goods_ht'  => $goods_ht,
			'weighable' => empty( $unweighed ),
			'unweighed' => $unweighed,
		);
	}

	/**
	 * Load the WooCommerce method class, once WooCommerce exists.
	 *
	 * From `includes/shipping/`, one directory below the rest, because the
	 * register's guard requires every file in `includes/` with no WordPress
	 * loaded and a class extending a missing `WC_Shipping_Method` is a fatal at
	 * parse time. See the header of that file.
	 */
	public static function declare_method(): void {
		require_once __DIR__ . '/shipping/colissimo.php';
	}

	/** @param array<string,mixed> $methods */
	public static function register_method( array $methods ): array {
		$methods[ self::METHOD_ID ] = __NAMESPACE__ . '\\Shipping_Colissimo';
		return $methods;
	}

	/**
	 * Why the last package could not be quoted, for the checkout to say so.
	 *
	 * A static rather than a session value: it is read in the same request that
	 * set it, by `Checkout::shipping_notice`, and a session write on every cart
	 * render is a write on every page of a shop that has to stay fast.
	 */
	private static string $refusal = '';

	public static function remember_refusal( string $reason ): void {
		self::$refusal = $reason;
	}

	public static function last_refusal(): string {
		return self::$refusal;
	}
}
