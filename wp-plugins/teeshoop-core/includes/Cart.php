<?php
/**
 * WooCommerce cart integration.
 *
 * The rule this file exists to enforce: A PRICE THAT ARRIVES FROM A BROWSER IS
 * NEVER CHARGED. What the cart stores is the *inputs* (garment, printed sides
 * and their areas, design id), and the price is recomputed from them, from the
 * server's own config, on every single totals pass. So a tampered session, a
 * replayed request, or a price that was correct last week and is not correct
 * today all resolve to today's correct number rather than to whatever was
 * cached.
 *
 * It also means the customer's own quantity controls keep working: Woo owns the
 * quantity, quantity drives the discount tier, and the unit price follows.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Cart {

	/** Key under which our payload rides in the cart item. */
	private const KEY = 'teeshoop';

	/**
	 * Shown once when a changed quantity invalidates a size breakdown.
	 *
	 * A constant because `wc_has_notice` matches on the message itself, and the
	 * alternative is the same sentence repeated for every line and every pass.
	 */
	private const GRID_DROPPED = 'La quantité a changé, donc la répartition par taille a été retirée de cette ligne. Indiquez-la de nouveau dans le studio avant de commander.';

	public static function init(): void {
		add_filter( 'woocommerce_add_cart_item_data', array( self::class, 'keep_items_distinct' ), 10, 3 );
		add_action( 'woocommerce_before_calculate_totals', array( self::class, 'recompute_prices' ), 20 );
		add_filter( 'woocommerce_get_item_data', array( self::class, 'show_in_cart' ), 10, 2 );
		add_action( 'woocommerce_checkout_create_order_line_item', array( self::class, 'persist_to_order' ), 10, 4 );

		/*
		 * THE GATES MUST HOLD AFTER THE LINE IS IN THE BASKET, NOT ONLY AT THE
		 * DOOR.
		 *
		 * `Cart::add` refuses a run past the shop's cap or past the self-serve
		 * threshold, and then WooCommerce renders an ordinary quantity box on the
		 * cart page (the line is not sold individually and has no maximum), so a
		 * customer who was refused 213 could add 212 and type 15 000 over it. The
		 * only thing that ran on that change was `recompute_prices`, which
		 * re-derives the PRICE and never re-asked whether we sell this at all.
		 *
		 * This is the same shape as the `did_action() > 1` guard that shipped
		 * here once: correct code on one side of a WooCommerce seam, and nothing
		 * watching the other.
		 */
		add_action( 'woocommerce_check_cart_items', array( self::class, 'check_cart_items' ) );

		/*
		 * THE CUSTOMER'S OWN DESIGN, IN THE PLACES THEY LOOK FOR IT.
		 *
		 * The flattened proof has been uploaded to R2 and frozen onto the line
		 * since session 01 (`files.preview` below, `_teeshoop_files` on the
		 * order), and until now NOTHING read it back except the bon a tirer. So a
		 * buyer who had just spent twenty minutes designing a shirt saw, in the
		 * cart and at the checkout, the supplier's photograph of a BLANK garment.
		 *
		 * WHICH HOOK COVERS WHAT, checked against the WooCommerce running in the
		 * local mirror rather than assumed, because the obvious filter is the
		 * wrong one on this shop:
		 *
		 *   · `woocommerce_store_api_cart_item_images` is the cart and the
		 *     checkout. Both pages here are BLOCKS (`wp:woocommerce/cart` and
		 *     `wp:woocommerce/checkout`), which read their lines from the Store
		 *     API and never render `templates/cart/cart.php`. This is the filter
		 *     that matters and it wants image OBJECTS with an id, a src and a
		 *     thumbnail that parse as URLs (`StoreApi/Schemas/V1/CartItemSchema`).
		 *   · `woocommerce_cart_item_thumbnail` is the mini-cart, and the cart
		 *     page of any shop that goes back to the shortcode.
		 *   · `woocommerce_order_item_thumbnail` is the transactional e-mail, and
		 *     only when WooCommerce's `email_improvements` feature is on: the
		 *     template gates it on `$show_image`, which defaults to that flag.
		 *
		 * The order-received page and the account history have NO such hook in
		 * this version, so they still show the blank. That is not fixed here.
		 *
		 * All three are display-only: no price and no production data goes
		 * through them, so the worst a failure can do is fall through to the
		 * product image, which is what happens today.
		 */
		add_filter( 'woocommerce_store_api_cart_item_images', array( self::class, 'block_cart_images' ), 10, 2 );
		add_filter( 'woocommerce_cart_item_thumbnail', array( self::class, 'design_thumbnail' ), 10, 3 );
		add_filter( 'woocommerce_order_item_thumbnail', array( self::class, 'order_thumbnail' ), 10, 2 );
		// …and ASK for the image in the e-mail rather than hoping a WooCommerce
		// feature flag is on. `wc_get_email_order_items` defaults `show_image` to
		// whether `email_improvements` is enabled, and the template renders no
		// thumbnail cell at all when it is false, so the filter above would never
		// be applied on a shop that has not opted in.
		add_filter(
			'woocommerce_email_order_items_args',
			static function ( $args ) {
				$args['show_image'] = true;
				return $args;
			}
		);
	}

	/**
	 * The cart and checkout BLOCKS, which read their images from the Store API.
	 *
	 * Returns the schema's own shape: an array of objects carrying an id, a src,
	 * a thumbnail and the responsive fields. WooCommerce validates each one and
	 * silently falls back to the product's images when any is malformed, which is
	 * the behaviour we want, so the checks here are the same ones it makes.
	 *
	 * @param array $images    Image objects WooCommerce was going to send.
	 * @param array $cart_item Cart item.
	 */
	public static function block_cart_images( $images, $cart_item ) {
		if ( ! is_array( $cart_item ) || empty( $cart_item[ self::KEY ]['files'] ) ) {
			return $images;
		}
		$url = self::preview_url( (array) $cart_item[ self::KEY ]['files'] );
		if ( '' === $url ) {
			return $images;
		}
		$image            = new \stdClass();
		$image->id        = 0;
		$image->src       = $url;
		$image->thumbnail = $url;
		$image->srcset    = '';
		$image->sizes     = '';
		$image->name      = __( 'Votre création', 'teeshoop' );
		$image->alt       = __( 'Votre création', 'teeshoop' );
		return array( $image );
	}

	/**
	 * The design's own proof image, sized for a thumbnail, or '' when the line
	 * has none.
	 *
	 * `Bat::worker_url` returns '' when the Worker address is unset, which is the
	 * fail-closed direction: no image rather than a broken one.
	 */
	private static function preview_url( array $files ): string {
		// Re-checked here as well as at `Design::verify`, because an order placed
		// before that guard existed carries whatever the manifest said then.
		$path = Design::normalise_preview( (string) ( $files['preview'] ?? '' ) );
		if ( '' === $path ) {
			return '';
		}
		$url = Bat::worker_url( $path );
		return wp_parse_url( $url, PHP_URL_HOST ) ? $url : '';
	}

	private static function preview_img( array $files, string $alt ): string {
		$url = self::preview_url( $files );
		if ( '' === $url ) {
			return '';
		}
		return sprintf(
			'<img src="%s" alt="%s" width="300" height="300" loading="lazy" decoding="async" style="object-fit:contain;background:transparent" />',
			esc_url( $url ),
			esc_attr( $alt )
		);
	}

	/**
	 * Cart and checkout thumbnail.
	 *
	 * @param string $html Whatever WooCommerce was going to show.
	 * @param array  $item Cart item.
	 */
	public static function design_thumbnail( $html, $item, $key = '' ) {
		unset( $key );
		if ( ! is_array( $item ) || empty( $item[ self::KEY ]['files'] ) ) {
			return $html;
		}
		$img = self::preview_img(
			(array) $item[ self::KEY ]['files'],
			__( 'Votre création', 'teeshoop' )
		);
		return '' === $img ? $html : $img;
	}

	/**
	 * Order-received page, account history and the transactional e-mails.
	 *
	 * The order line keeps the file list as JSON (`_teeshoop_files`), because the
	 * cart's array is gone by then and an order has to be able to say what was
	 * bought years later without asking the Worker to still know.
	 */
	public static function order_thumbnail( $html, $item ) {
		if ( ! $item instanceof \WC_Order_Item_Product ) {
			return $html;
		}
		$raw = (string) $item->get_meta( '_teeshoop_files', true );
		if ( '' === $raw ) {
			return $html;
		}
		$files = json_decode( $raw, true );
		if ( ! is_array( $files ) ) {
			return $html;
		}
		$img = self::preview_img( $files, __( 'Votre création', 'teeshoop' ) );
		return '' === $img ? $html : $img;
	}

	/**
	 * Add a personalised line to the cart.
	 *
	 * $payload:
	 *   product_id int
	 *   qty        int
	 *   garment    string  what the studio BELIEVES it drew on; see below
	 *   sides      array   fallback only; the verified design's own sides win
	 *   design_id  string
	 *   size_grid  array   ['M' => 10, 'L' => 15, …] optional
	 *
	 * Returns the cart item key, or a WP_Error. Nothing here trusts a price, and
	 * as of this version nothing here trusts a price INPUT either: the garment
	 * comes from the product (Product.php) and the printed areas come from the
	 * design manifest the Worker confirmed.
	 *
	 * @return string|\WP_Error
	 */
	/**
	 * Le poids d'une pièce en grammes, ou 0 quand il est inconnu.
	 *
	 * ZÉRO EST « ON N'A PAS PU PESER ». `WC_Product::get_weight()` rend '' pour
	 * un produit dont personne n'a saisi le poids ; le lire comme 0 g mettrait
	 * chaque colis dans la tranche la plus légère de la grille Colissimo, et
	 * ferait passer ce contrôle-ci pour « aucune limite ». La même distinction
	 * que `Shipping::NO_WEIGHT` fait au moment d'affranchir.
	 */
	private static function unit_grams( \WC_Product $product ): int {
		$weight = $product->get_weight();
		if ( '' === $weight || null === $weight || ! is_numeric( $weight ) || (float) $weight <= 0 ) {
			return 0;
		}
		return (int) round( (float) wc_get_weight( (float) $weight, 'g' ) );
	}

	public static function add( array $payload ) {
		$product_id = (int) ( $payload['product_id'] ?? 0 );
		$product    = $product_id > 0 ? wc_get_product( $product_id ) : null;

		if ( ! $product || ! $product->is_purchasable() ) {
			return new \WP_Error( 'teeshoop_bad_product', __( 'Cet article ne peut pas être personnalisé.', 'teeshoop' ), array( 'status' => 400 ) );
		}

		/*
		 * The garment is the PRODUCT's, not the request's.
		 *
		 * It decides the price of the blank, so taking it from the body let a
		 * request name `custom` (base 0,00 EUR, because the customer ships their
		 * own garment) on a hoodie product and buy a 27,00 EUR blank for
		 * nothing. Product::garment_of is the authority. A request that names a
		 * different one is REFUSED rather than corrected: it means the page and
		 * the studio are selling two different things, and silently charging for
		 * the page's one would deliver a garment nobody chose.
		 */
		$garment = Product::garment_of( $product_id );
		if ( '' === $garment ) {
			return new \WP_Error(
				'teeshoop_not_personalisable',
				__( 'Cet article n’est pas configuré pour la personnalisation.', 'teeshoop' ),
				array( 'status' => 400 )
			);
		}
		$claimed = sanitize_key( (string) ( $payload['garment'] ?? '' ) );
		if ( '' !== $claimed && $claimed !== $garment ) {
			return new \WP_Error(
				'teeshoop_garment_mismatch',
				__( 'Cette page vend un autre vêtement que celui sur lequel la création a été faite.', 'teeshoop' ),
				array( 'status' => 409 )
			);
		}

		$config = Settings::pricing();

		$design_id = (string) ( $payload['design_id'] ?? '' );
		$check     = Design::verify( $design_id );
		if ( ! $check['ok'] ) {
			return new \WP_Error(
				'teeshoop_design_' . $check['reason'],
				__( 'La création n’a pas pu être confirmée. Rien n’a été ajouté au panier.', 'teeshoop' ),
				array( 'status' => 422 )
			);
		}

		/*
		 * The printed areas come from the DESIGN, not from the request.
		 *
		 * The Worker recorded them when the studio uploaded the artwork, so they
		 * are the same numbers the workshop's transfers will be rendered from.
		 * Pricing off the add-to-cart body instead would let the invoice and the
		 * film disagree, and would let a replayed request claim 1 cm² of ink on
		 * a full-front print. The body is kept only as a fallback for local
		 * development, where TEESHOOP_ALLOW_UNVERIFIED_DESIGNS means there is no
		 * manifest to read.
		 */
		$sides = Design::normalise_sides( $check['meta']['sides'] ?? array() );
		if ( empty( $sides ) && ! empty( $check['meta']['verified'] ) ) {
			/*
			 * A CONFIRMED design that prints nothing is refused, never priced.
			 *
			 * `empty( $sides )` used to fall through to the request's sides for
			 * this case too, which made the whole rule above decorative: upload a
			 * real document with the `sides` key removed, POST `sides: []`, and
			 * the line prices as an unprinted blank while the stored artwork is
			 * still there for the workshop to press. Measured on the shipped
			 * config: a tee run of 50 fell from 926,50 EUR to 308,50 EUR HT, and a
			 * `custom` garment, whose blank is free because the customer ships it,
			 * came to 0,00 EUR. The Worker now refuses such a document
			 * (src/lib/teeshoop/designDoc.ts); this is the second lock, because
			 * designs uploaded before it exists would still verify.
			 */
			return new \WP_Error(
				'teeshoop_design_prints_nothing',
				__( 'Cette création n’a aucune face imprimée. Rien n’a été ajouté au panier.', 'teeshoop' ),
				array( 'status' => 422 )
			);
		}
		if ( empty( $sides ) ) {
			// Unverified, i.e. TEESHOOP_ALLOW_UNVERIFIED_DESIGNS in local
			// development: there is no manifest to read, so the body is all there is.
			$sides = Design::normalise_sides( $payload['sides'] ?? array() );
			$sides_source = 'request';
		} else {
			$sides_source = 'design';
			$sent = Design::normalise_sides( $payload['sides'] ?? array() );
			if ( ! empty( $sent ) && wp_json_encode( $sent ) !== wp_json_encode( $sides ) ) {
				// Not fatal, the design wins. But it means the studio and the
				// stored artwork disagree about what is printed, which is a bug
				// somewhere and must not be invisible.
				self::log( 'sides differ from the stored design for ' . $design_id );
			}
		}

		$qty = max( 1, min( (int) ( $payload['qty'] ?? 1 ), (int) $config['max_qty'] ) );

		$size_grid = self::normalise_size_grid( $payload['size_grid'] ?? array() );
		if ( ! empty( $size_grid ) ) {
			// The grid IS the quantity when it is present: a customer who typed
			// "10 M, 15 L" ordered 25 garments, whatever the qty field said.
			$qty = (int) array_sum( $size_grid );
			/*
			 * REFUSED, not clamped. `min( $qty, max_qty )` charged the cap while
			 * storing the whole grid, so an order of 12 000 pieces was billed as
			 * 10 000 and printed as 12 000: the grid is the only record of which
			 * sizes to press, so 2 000 garments would have been made and never
			 * invoiced. Silently reducing what someone ordered is also the wrong
			 * answer to give a buyer.
			 */
			if ( $qty > (int) $config['max_qty'] ) {
				return new \WP_Error(
					'teeshoop_qty_too_high',
					sprintf(
						/* translators: %d: the largest quantity the shop accepts on one line. */
						__( 'Cette commande dépasse %d pièces sur une seule ligne. Contactez-nous, nous la traitons à la main.', 'teeshoop' ),
						(int) $config['max_qty']
					),
					array( 'status' => 400 )
				);
			}
			$qty = max( 1, $qty );
		}

		/*
		 * CAN THE WORKSHOP ACTUALLY PRESS THIS, AT THE SIZES ORDERED?
		 *
		 * ── WHY THIS EXISTS, AND WHY IT DID NOT NEED TO BEFORE ───────────────
		 *
		 * Every rectangle on a design is measured at the PRICED size, M, and the
		 * studio grades a print with the garment: a 3XL chest is 64 cm where an M
		 * is 52, so the same artwork prints about 23 % larger in each direction.
		 * That was question 37 and it was a question about the PRICE, worth a
		 * warning on a margin report and no more, because a graded transfer still
		 * fitted comfortably on a 56 cm roll cut at 100 cm.
		 *
		 * Question 04's answer of 1 September 2026 put the shop on a 33 x 46 cm
		 * A3+ sheet, and it stopped fitting. Measured against `garments.json` on
		 * the same day: a full front or back print fits at S, M and L on both
		 * garments, and fits at NO orientation from XL upward, where the zone is
		 * up to 37,5 x 50 cm. Half the size range. The cost engine cannot see it,
		 * because it measures the M rectangle whatever was ordered, so without
		 * this the shop takes the money and the workshop discovers it at the
		 * press.
		 *
		 * ── THE GRADING FACTOR IS READ, NOT REIMPLEMENTED ────────────────────
		 *
		 * `data/garments.json` is generated from the studio's own definitions and
		 * `npm run verify:garments` fails when the two diverge, so the ratio
		 * between a side's published zone at the ordered size and at the priced
		 * size IS the studio's grading factor. Deriving it here would be a second
		 * implementation of the one rule that decides how big a print comes out.
		 *
		 * IT REFUSES THE LINE AND NAMES THE SIZE, because « votre visuel est trop
		 * grand » is not actionable: the same design is printable one size down,
		 * and the customer can choose.
		 */
		$too_big = Design::unprintable_sizes( $garment, $sides, $size_grid );
		if ( ! empty( $too_big ) ) {
			return new \WP_Error(
				'teeshoop_design_too_large',
				sprintf(
					/* translators: %s: comma-separated garment sizes, e.g. "XL, 2XL". */
					__( 'Ce visuel ne peut pas être imprimé dans les tailles suivantes : %s. Le marquage grandit avec le vêtement, et à ces tailles il dépasse le format que notre imprimeur peut produire. Réduisez le visuel, ou retirez ces tailles de la commande.', 'teeshoop' ),
					implode( ', ', $too_big )
				),
				array( 'status' => 422 )
			);
		}

		/*
		 * PAST THE THRESHOLD, THE SITE STOPS PRICING AND A HUMAN STARTS.
		 *
		 * Enforced here and not only on the product page, because a rule the
		 * cart does not apply is a rule the page is merely decorating with. The
		 * verdict itself comes from `Pricing::needs_quote`, the same function
		 * the page and the studio's basket panel read, so the three cannot
		 * disagree about whether a run is self-serve.
		 *
		 * The message names the way forward rather than saying no: at this size
		 * the customer usually gets a better price from the quote than from the
		 * public grid, which is the whole reason the threshold exists.
		 */
		try {
			$check_quote = Pricing::quote(
				array(
					'garment' => $garment,
					'qty'     => $qty,
					'sides'   => $sides,
				),
				$config
			);
		} catch ( \InvalidArgumentException $e ) {
			return new \WP_Error( 'teeshoop_unknown_garment', __( 'Ce vêtement n’est plus au catalogue.', 'teeshoop' ), array( 'status' => 400 ) );
		}

		if ( ! empty( $check_quote['needs_quote'] ) ) {
			return new \WP_Error(
				'teeshoop_needs_quote',
				sprintf(
					/* translators: 1: a quantity, 2: an amount excl. VAT. */
					__( 'Au-delà de %1$d pièces ou de %2$s hors taxes, nous chiffrons la commande à la main. Demandez un devis depuis la fiche produit, votre création est conservée.', 'teeshoop' ),
					(int) $config['quote_from_qty'],
					Money::format( (int) $config['quote_from_ht'] )
				),
				array( 'status' => 409 )
			);
		}

		/*
		 * ── ET CE QU'UN COLIS NE PORTE PAS ────────────────────────────────────
		 *
		 * `Pricing::needs_quote` connaît la quantité et le montant. Il ne connaît
		 * pas le POIDS : `Pricing` est pur et n'a ni transporteur ni balance. La
		 * grille de la fiche retenait déjà les colonnes trop lourdes
		 * (`ProductPage::grid_rows`), et le panier ne les retenait pas.
		 *
		 * Mesuré le 4 septembre 2026 par la passe adversariale : cinquante sweats
		 * Fruit of the Loom pèsent 35 kg, cinq de plus que la grille Colissimo ne
		 * sait affranchir. La fiche imprimait « sur devis », l'encadré d'achat de
		 * la MÊME page imprimait « 1 267,50 EUR HT », `Cart::add` acceptait la
		 * ligne, et le client arrivait à une caisse sans aucun mode de livraison,
		 * avec un panier à 1 521,00 EUR TTC. Trois réponses pour une case, et
		 * c'est le chemin qui prend l'argent qui prenait la plus optimiste.
		 *
		 * La borne est lue ici plutôt que recopiée : `Shipping::max_pieces` est
		 * la seule maison de la règle, et `null` (« on n'a pas pu peser ») refuse
		 * comme zéro, parce qu'un produit sans poids n'a pas de tarif de
		 * livraison du tout.
		 */
		$parcel_max = Shipping::max_pieces( self::unit_grams( $product ), Shipping::config() );
		if ( null === $parcel_max || $qty > $parcel_max ) {
			return new \WP_Error(
				'teeshoop_parcel_too_heavy',
				sprintf(
					/* translators: %d: how many pieces fit in one parcel. */
					_n(
						'Cette quantité dépasse ce qu’un colis peut porter (%d pièce). Nous organisons la livraison à la main : demandez un devis depuis la fiche produit, votre création est conservée.',
						'Cette quantité dépasse ce qu’un colis peut porter (%d pièces). Nous organisons la livraison à la main : demandez un devis depuis la fiche produit, votre création est conservée.',
						(int) ( $parcel_max ?? 0 ),
						'teeshoop'
					),
					(int) ( $parcel_max ?? 0 )
				),
				array( 'status' => 409 )
			);
		}

		$data = array(
			'garment'      => $garment,
			'sides'        => $sides,
			// Which of the two the price was computed from, frozen onto the
			// order. Eighteen months from now it is the difference between "the
			// workshop's file says 400 cm²" and "we do not know what we billed".
			'sides_source' => $sides_source,
			'design_id'    => $design_id,
			'size_grid'    => $size_grid,
			'verified'     => (bool) ( $check['meta']['verified'] ?? false ),
			/*
			 * THE COLOUR THE DESIGN WAS MADE ON, frozen with everything else.
			 *
			 * Mandatory content of a bon à tirer (chapitre 2) and it exists
			 * nowhere on this side otherwise: the garment comes from the product
			 * and the areas come from the manifest, but the colour is the
			 * customer's own choice inside the studio. Frozen here rather than
			 * fetched when the proof is issued, so a proof is composed from the
			 * ORDER and does not depend on a network call whose failure would
			 * stop the workshop.
			 */
			'colour'       => (string) ( $check['meta']['color'] ?? '' ),
			/*
			 * THE BLANK THIS IS SOLD AS, resolved now and never again. The
			 * reasoning is at the `add_meta_data` call that stores it.
			 *
			 * It is read from the product, like the garment above and for the
			 * same reason, and it is allowed to be empty: a shop that has not
			 * declared its blanks yet still sells, and the purchase basket then
			 * refuses that line by name rather than the cart refusing the sale.
			 */
			'blank_ref'    => Product::blank_ref_of( $product_id ),
			'blank_colour' => (string) ( Product::blank_colours_of( $product_id )[ (string) ( $check['meta']['color'] ?? '' ) ] ?? '' ),
			'files'        => array(
				'print'    => (string) ( $check['meta']['print_file'] ?? '' ),
				'preview'  => (string) ( $check['meta']['preview'] ?? '' ),
				'previews' => (array) ( $check['meta']['previews'] ?? array() ),
			),
		);

		$key = WC()->cart->add_to_cart( $product_id, $qty, 0, array(), array( self::KEY => $data ) );

		return false === $key
			? new \WP_Error( 'teeshoop_cart_refused', __( 'Le panier a refusé la ligne.', 'teeshoop' ), array( 'status' => 409 ) )
			: $key;
	}

	/**
	 * Give every personalised line its own cart row.
	 *
	 * Without this, WooCommerce merges two lines of the same product by bumping
	 * the quantity, so a customer who designed two different fronts would end up
	 * with two of whichever they made first. The design id alone is not enough to
	 * key on: the same design ordered in two different size grids is two lines.
	 */
	public static function keep_items_distinct( array $data, int $product_id, int $variation_id ): array {
		if ( isset( $data[ self::KEY ] ) ) {
			$data['teeshoop_unique'] = md5( wp_json_encode( $data[ self::KEY ] ) . microtime() );
		}
		return $data;
	}

	/**
	 * Recompute every personalised line's price, from its inputs.
	 *
	 * Runs on `woocommerce_before_calculate_totals`, which fires on the cart page,
	 * at checkout, and again when the order is created, so there is no window in
	 * which a stale price could be taken.
	 *
	 * The `is_admin() && ! wp_doing_ajax()` guard is the standard Woo one: without
	 * it this also runs while a shop manager edits an existing order in the admin,
	 * silently repricing a line the customer already paid.
	 */
	public static function recompute_prices( \WC_Cart $cart ): void {
		if ( is_admin() && ! wp_doing_ajax() ) {
			return;
		}

		/*
		 * There is deliberately NO `did_action(...) > 1` guard here.
		 *
		 * That guard is the standard snippet for this hook, and it is wrong for
		 * this plugin. It exists to stop RELATIVE price changes (`set_price(
		 * get_price() * 0.9 )`) from compounding when Woo recalculates twice in
		 * one request. What we do is absolute: the price is derived from the
		 * line's stored inputs and the server's config, so running it ten times
		 * gives the same answer as running it once.
		 *
		 * With the guard in place, only the FIRST calculate_totals of a request
		 * took effect, so a customer who changed the quantity on the cart page
		 * crossed a discount threshold and kept the old unit price. Measured
		 * 2026-08-12: qty 9 → 50 all stayed at the qty-30 rate.
		 */
		$config = Settings::pricing();

		foreach ( $cart->get_cart() as $item ) {
			if ( empty( $item[ self::KEY ] ) || ! isset( $item['data'] ) ) {
				continue;
			}
			$data = $item[ self::KEY ];

			/*
			 * THE QUANTITY AND THE SIZE GRID MAY NEVER DISAGREE.
			 *
			 * Nothing stops WooCommerce rendering its own quantity box for a
			 * personalised line, and a customer who typed 1 over a grid of 30 got
			 * a line billed 14,50 EUR carrying the visible meta
			 * "Tailles : 10 × M · 15 × L · 5 × XL". Whichever number the workshop
			 * believed, one of them was wrong, and the expensive direction is 29
			 * garments printed and never invoiced.
			 *
			 * The quantity wins, because it is what the customer last chose, and
			 * the stale breakdown is DROPPED rather than kept as a wrong one. It
			 * is enforced here rather than in a cart-page filter because this hook
			 * is the one path every quantity change goes through: the classic
			 * cart, the Store API the block cart uses, and the checkout.
			 */
			$grid_sum = (int) array_sum( array_map( 'intval', (array) ( $data['size_grid'] ?? array() ) ) );
			if ( $grid_sum > 0 && $grid_sum !== (int) $item['quantity'] ) {
				$cart->cart_contents[ $item['key'] ][ self::KEY ]['size_grid'] = array();
				$data['size_grid'] = array();
				self::log( 'size grid dropped: quantity ' . (int) $item['quantity'] . ' vs grid ' . $grid_sum );
				if ( function_exists( 'wc_add_notice' ) && ! wc_has_notice( self::GRID_DROPPED, 'notice' ) ) {
					wc_add_notice( self::GRID_DROPPED, 'notice' );
				}
			}

			try {
				$quote = Pricing::quote(
					array(
						'garment' => (string) ( $data['garment'] ?? '' ),
						'qty'     => (int) $item['quantity'],
						'sides'   => (array) ( $data['sides'] ?? array() ),
					),
					$config
				);
			} catch ( \InvalidArgumentException $e ) {
				// A garment that no longer exists in the config. Leave the product's
				// own price rather than charging zero, and say so in the log.
				self::log( 'unknown garment in cart: ' . ( $data['garment'] ?? '?' ) );
				continue;
			}

			// Woo wants a unit price in the store's currency, excl. tax when the
			// store is configured to enter prices excl. tax, which is the setting
			// this shop uses, because its customers are businesses.
			$unit = (string) Money::to_eur( $quote['unit_ht'] );

			/*
			 * THE REGULAR PRICE TOO, and this is not tidiness.
			 *
			 * `$item['data']` is this line's own clone of the product, so it kept
			 * the catalogue's regular price while `set_price` lowered the active
			 * one. WooCommerce reads that as a SALE and renders the catalogue
			 * price struck through with the difference as a saving: the
			 * verification cart showed "99,99 € 15,37 € — Save 2 115,50 €" for an
			 * order that was never on sale and never cost 99,99 EUR.
			 *
			 * An invented reference price is not a cosmetic bug in France. The
			 * price a personalised line is compared against has to be a price
			 * that was actually charged (Code de la consommation, L.112-1-1 and
			 * the prix de référence rules); announcing a saving that never
			 * existed is a pratique commerciale trompeuse. A personalised line
			 * has no catalogue price at all, so it has exactly one price.
			 */
			$item['data']->set_regular_price( $unit );
			$item['data']->set_sale_price( '' );
			$item['data']->set_price( $unit );
		}
	}

	/**
	 * Re-run the gates on the cart and at checkout, on whatever quantity is
	 * there now.
	 *
	 * `woocommerce_check_cart_items` is the hook WooCommerce itself uses for
	 * "this basket cannot proceed": an error notice raised here blocks the
	 * checkout button and the checkout POST, so there is no window in which a
	 * refused run can be paid for.
	 *
	 * It says which line and what to do, because a basket that simply refuses to
	 * proceed with no explanation is worse than one that never accepted the line.
	 */
	public static function check_cart_items(): void {
		if ( ! function_exists( 'WC' ) || ! WC()->cart || ! function_exists( 'wc_add_notice' ) ) {
			return;
		}

		$config = Settings::pricing();
		$max    = (int) $config['max_qty'];

		foreach ( WC()->cart->get_cart() as $item ) {
			if ( empty( $item[ self::KEY ] ) ) {
				continue;
			}
			$data = $item[ self::KEY ];
			$qty  = (int) $item['quantity'];
			$name = isset( $item['data'] ) && $item['data'] instanceof \WC_Product
				? $item['data']->get_name()
				: __( 'cet article', 'teeshoop' );

			if ( $qty > $max ) {
				wc_add_notice(
					sprintf(
						/* translators: 1: product name, 2: the largest quantity accepted on one line. */
						__( '%1$s : %2$d pièces au maximum sur une seule ligne. Demandez un devis, nous traitons cette quantité à la main.', 'teeshoop' ),
						esc_html( $name ),
						$max
					),
					'error'
				);
				continue;
			}

			try {
				$quote = Pricing::quote(
					array(
						'garment' => (string) ( $data['garment'] ?? '' ),
						'qty'     => $qty,
						'sides'   => (array) ( $data['sides'] ?? array() ),
					),
					$config
				);
			} catch ( \InvalidArgumentException $e ) {
				continue;
			}

			if ( ! empty( $quote['needs_quote'] ) ) {
				wc_add_notice(
					sprintf(
						/* translators: 1: product name, 2: a quantity, 3: an amount excl. VAT. */
						__( '%1$s : au-delà de %2$d pièces ou de %3$s hors taxes, nous chiffrons la commande à la main. Demandez un devis depuis la fiche produit, ou réduisez la quantité.', 'teeshoop' ),
						esc_html( $name ),
						(int) $config['quote_from_qty'],
						Money::format( (int) $config['quote_from_ht'] )
					),
					'error'
				);
			}
		}
	}

	/** What the customer sees on the cart and checkout pages. */
	public static function show_in_cart( array $rows, array $item ): array {
		if ( empty( $item[ self::KEY ] ) ) {
			return $rows;
		}
		$data = $item[ self::KEY ];

		$sides = array();
		foreach ( (array) ( $data['sides'] ?? array() ) as $side ) {
			$sides[] = self::side_label( (string) $side['id'] );
		}
		if ( ! empty( $sides ) ) {
			$rows[] = array(
				'key'   => __( 'Faces imprimées', 'teeshoop' ),
				'value' => implode( ', ', $sides ),
			);
		}

		if ( ! empty( $data['size_grid'] ) ) {
			$parts = array();
			foreach ( $data['size_grid'] as $size => $count ) {
				$parts[] = $count . ' × ' . strtoupper( $size );
			}
			$rows[] = array(
				'key'   => __( 'Tailles', 'teeshoop' ),
				'value' => implode( ' · ', $parts ),
			);
		}

		if ( ! empty( $data['design_id'] ) ) {
			$rows[] = array(
				'key'   => __( 'Création', 'teeshoop' ),
				'value' => '<code>' . esc_html( $data['design_id'] ) . '</code>',
			);
		}

		return $rows;
	}

	/**
	 * Freeze the line onto the order.
	 *
	 * The design id and the printed sides are what the workshop works from, so
	 * they are stored as visible meta. The R2 paths are stored with a leading
	 * underscore: hidden from the customer's order view, present for the
	 * production screen.
	 */
	public static function persist_to_order( \WC_Order_Item_Product $line, string $cart_item_key, array $values, \WC_Order $order ): void {
		if ( empty( $values[ self::KEY ] ) ) {
			return;
		}
		$data = $values[ self::KEY ];

		$line->add_meta_data( __( 'Création', 'teeshoop' ), (string) ( $data['design_id'] ?? '' ), true );

		$sides = array();
		foreach ( (array) ( $data['sides'] ?? array() ) as $side ) {
			$sides[] = self::side_label( (string) $side['id'] );
		}
		if ( ! empty( $sides ) ) {
			$line->add_meta_data( __( 'Faces imprimées', 'teeshoop' ), implode( ', ', $sides ), true );
		}

		if ( ! empty( $data['size_grid'] ) ) {
			$parts = array();
			foreach ( $data['size_grid'] as $size => $count ) {
				$parts[] = $count . ' × ' . strtoupper( $size );
			}
			$line->add_meta_data( __( 'Tailles', 'teeshoop' ), implode( ' · ', $parts ), true );
		}

		// Hidden: the production hand-off.
		$line->add_meta_data( '_teeshoop_design_id', (string) ( $data['design_id'] ?? '' ), true );
		$line->add_meta_data( '_teeshoop_garment', (string) ( $data['garment'] ?? '' ), true );
		$line->add_meta_data( '_teeshoop_sides', wp_json_encode( $data['sides'] ?? array() ), true );
		// AS DATA, not only as the display string above. `renderPieces` needs the
		// size to grade the transfer, and `printScaleK` returns 1 without one: a
		// workshop re-rendering from a human-readable "10 × M · 15 × L" that it
		// cannot parse would press every garment at the base size, so a 3XL would
		// carry an M-sized chest print, 23 % narrow.
		$line->add_meta_data( '_teeshoop_size_grid', wp_json_encode( $data['size_grid'] ?? array() ), true );
		$line->add_meta_data( '_teeshoop_sides_source', (string) ( $data['sides_source'] ?? '' ), true );
		$line->add_meta_data( '_teeshoop_couleur', (string) ( $data['colour'] ?? '' ), true );

		/*
		 * WHICH BLANK THIS LINE WAS SOLD AS, frozen here and not looked up later.
		 *
		 * ── WHAT THIS PREVENTS, AND IT IS A SCRAPPED RUN ────────────────────
		 *
		 * The blank is declared on the PRODUCT (`Product::META_BLANK_REF` and its
		 * colour map), and the purchase basket used to read it at the moment
		 * somebody pressed « Préparer », which is days after the sale and often
		 * after the film is printed. A shop manager who changes that reference,
		 * because a style is discontinued, changes what the workshop buys FOR
		 * ORDERS ALREADY SOLD. Reproduced on the mirror by the adversarial pass:
		 * reference 00142 changed to 00517, the colour name « Navy » exists on
		 * both because `pa_couleur` is one global taxonomy, nothing refused, and
		 * twenty polos were bought for a run whose film was printed for t-shirts.
		 *
		 * Frozen, the basket buys what was sold. A declaration that has moved
		 * since is then a difference the screen can NAME, instead of a silent
		 * substitution nobody sees until the boxes are opened.
		 *
		 * Sealed with the rest of the procurement identity (`Shelf::SEALED`): the
		 * reference is the supplier's style number, which is most of the article
		 * number that seal exists to hide.
		 */
		$line->add_meta_data( '_teeshoop_blank_ref', (string) ( $data['blank_ref'] ?? '' ), true );
		$line->add_meta_data( '_teeshoop_blank_colour', (string) ( $data['blank_colour'] ?? '' ), true );
		$line->add_meta_data( '_teeshoop_files', wp_json_encode( $data['files'] ?? array() ), true );
		$line->add_meta_data( '_teeshoop_verified', ! empty( $data['verified'] ) ? 'yes' : 'no', true );

		/*
		 * AND WHAT THE PRICE RESOLVED TO, not only what it was computed from.
		 *
		 * The inputs above are enough to RE-derive the line, and re-deriving is
		 * exactly what an order eighteen months old cannot afford: it would need
		 * the price config of the day, which by then has moved. The order keeps
		 * that config (`Checkout::freeze`), so the two together are complete,
		 * but an accountant or a customer asking "why 20,82 EUR" should not have
		 * to run a pricing engine to be answered. The resolved unit price, the
		 * discount rate that produced it and the area tier each face fell into
		 * are three scalars that answer it directly.
		 *
		 * Recomputed here rather than read off WooCommerce's line, because
		 * WooCommerce holds a rounded euro figure and this holds integer cents;
		 * it is the same quote, in the same request, from the same config.
		 */
		try {
			$quote = Pricing::quote(
				array(
					'garment' => (string) ( $data['garment'] ?? '' ),
					'qty'     => (int) $line->get_quantity(),
					'sides'   => (array) ( $data['sides'] ?? array() ),
				),
				Settings::pricing()
			);
		} catch ( \InvalidArgumentException $e ) {
			// A garment the config no longer knows. The line still carries its
			// inputs; it simply cannot say what they resolved to.
			return;
		}

		$tiers = array();
		foreach ( $quote['lines'] as $part ) {
			if ( 'side' === $part['kind'] ) {
				$tiers[ (string) $part['label'] ] = (string) $part['tier'];
			}
		}

		$line->add_meta_data( '_teeshoop_unit_ht', (string) $quote['unit_ht'], true );
		$line->add_meta_data( '_teeshoop_discount_rate', (string) $quote['discount_rate'], true );
		$line->add_meta_data( '_teeshoop_tiers', wp_json_encode( $tiers ), true );
	}

	/**
	 * A size grid: uppercase size keys to positive whole counts.
	 *
	 * "10 M, 15 L, 5 XL on one line" is the thing neither Mistertee nor Tostadora
	 * does. Both make the customer re-enter the editor per size. It is worth
	 * getting the validation right rather than trusting the field.
	 */
	private static function normalise_size_grid( mixed $raw ): array {
		if ( ! is_array( $raw ) ) {
			return array();
		}
		$out = array();
		foreach ( $raw as $size => $count ) {
			$size  = strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', (string) $size ) ?? '' );
			$count = (int) $count;
			if ( '' !== $size && $count > 0 && strlen( $size ) <= 4 ) {
				$out[ $size ] = $count;
			}
			if ( count( $out ) >= 12 ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * The side ids are the studio's own `Side` union (src/lib/types.ts), which
	 * today is front, back and a single sleeve. `sleeve_l` and `sleeve_r` are
	 * kept because the DTF module and the price engine both accept them and a
	 * second sleeve position is a small studio change, not a protocol one.
	 *
	 * Public because the product page names the same sides in its print-area
	 * table, and a second list of French labels would be a second place for
	 * "Manche" to become "Manches" for one of them.
	 */
	/**
	 * Whether this basket carries anything personalised.
	 *
	 * A PREDICATE RATHER THAN A PUBLIC `KEY`. What makes a line personalised is
	 * this file's business, and the shape of the cart item is deliberately
	 * private: the day it grows a field, every reader outside would have to be
	 * found. `Waiver` needs the answer and not the shape.
	 */
	public static function has_personalised( ?\WC_Cart $cart = null ): bool {
		$cart = $cart ?? ( function_exists( 'WC' ) && WC()->cart ? WC()->cart : null );
		if ( ! $cart instanceof \WC_Cart ) {
			return false;
		}
		foreach ( $cart->get_cart() as $item ) {
			if ( ! empty( $item[ self::KEY ]['design_id'] ) ) {
				return true;
			}
		}
		return false;
	}

	public static function side_label( string $id ): string {
		$labels = array(
			'front'    => __( 'Devant', 'teeshoop' ),
			'back'     => __( 'Dos', 'teeshoop' ),
			'sleeve'   => __( 'Manche', 'teeshoop' ),
			'sleeve_l' => __( 'Manche gauche', 'teeshoop' ),
			'sleeve_r' => __( 'Manche droite', 'teeshoop' ),
		);
		return $labels[ $id ] ?? ucfirst( str_replace( '_', ' ', $id ) );
	}

	private static function log( string $message ): void {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( '[teeshoop] ' . $message ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		}
	}
}
