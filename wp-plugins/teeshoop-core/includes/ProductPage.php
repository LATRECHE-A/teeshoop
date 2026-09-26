<?php
/**
 * The product page, before anyone opens the editor.
 *
 * A buyer landing here must be able to answer four questions without clicking
 * into the studio: what is this garment, what does it cost me at MY quantity,
 * how large can I print, and how do I get a price for two hundred of them.
 * Mistertee answers the second and hides the third; Tostadora answers neither
 * and shows a percentage instead of a euro. The third is the one we own,
 * because we bill the ink and not the box it was dropped into.
 *
 * SHIPPED BY THE PLUGIN, HOOKED, NEVER OVERRIDING A WOOCOMMERCE TEMPLATE. The
 * reasoning is in Compat.php, which also pins the hooks this file depends on.
 * The markup lives in templates/teeshoop/*.php and is loaded through
 * `wc_get_template`, so a theme can override it at `yourtheme/teeshoop/x.php`
 * and so the set of files that could leak a purchase cost stays finite and
 * greppable (scripts/php-guard.mjs).
 *
 * EVERY PRICE ON THIS PAGE COMES FROM Pricing. Not one is computed here, and
 * not one is computed in the browser. The estimator's live total is a call to
 * `GET /wp-json/teeshoop/v1/quote`; without JavaScript the same estimate is
 * produced by submitting the form, server-side, and the grid below it is
 * server-rendered either way. A second price engine in JavaScript would be one
 * more thing to disagree with the invoice.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class ProductPage {

	/** @var array<string,array> Headline per garment, so an archive of 100 does not recompute 100 times. */
	private static array $headlines = array();

	public static function init(): void {
		add_action( 'wp', array( self::class, 'take_over' ) );

		/*
		 * The catalogue price of a personalisable product is not a price anyone
		 * pays, so it must never be printed as one. It is the blank's cost
		 * basis; what the customer pays is the blank plus the marking of each
		 * printed side, less the quantity break. Woo renders `get_price_html`
		 * on the product page, in every loop, in the cart widget and in
		 * structured data, so the substitution has to happen at the source.
		 */
		add_filter( 'woocommerce_get_price_html', array( self::class, 'price_html' ), 10, 2 );

		/*
		 * An archive's button says "Ajouter au panier" and adds a line in one
		 * click. On a personalisable product there is nothing to add yet, so it
		 * becomes a link to the page where there will be.
		 */
		add_filter( 'woocommerce_loop_add_to_cart_link', array( self::class, 'loop_link' ), 10, 2 );

		/*
		 * THE LOCK, and it does not depend on any of the rendering above.
		 *
		 * Every path that adds a line WITHOUT going through Cart::add lands
		 * here: the classic form, the `?add-to-cart=` URL, the AJAX loop
		 * button, the Store API the block cart uses, and "commander à nouveau".
		 * None of them can carry a design, so none of them may buy a
		 * personalisable product.
		 */
		add_filter( 'woocommerce_add_to_cart_validation', array( self::class, 'refuse_plain_add' ), 10, 6 );

		/*
		 * The machine-readable price has to be the same price as the human one.
		 *
		 * `WC_Structured_Data::generate_product_data` builds its offer from
		 * `$product->get_price()`, never from `get_price_html`, so the filter
		 * above cannot reach it: the page showed "9,42 EUR HT dès 50 pièces" to a
		 * reader and published 9,50 EUR to Google as the price of the product. A
		 * shopping result quoting a price nobody can pay is a complaint, and in
		 * France an announced price is an offer.
		 */
		add_filter( 'woocommerce_structured_data_product', array( self::class, 'structured_data' ), 10, 2 );

		add_filter( 'wp_robots', array( self::class, 'robots' ) );
	}

	/**
	 * Replace the offer with the range a customer can actually reach.
	 *
	 * An AggregateOffer, because there is no single price: the unit price falls
	 * with the quantity, and both ends of that range are real cells of the grid
	 * printed on the page (`Pricing::headline`). TTC, because schema.org's
	 * `price` is what the buyer pays and a consumer pays tax.
	 */
	/**
	 * Ce produit peut-il ANNONCER un prix, c'est-à-dire faire une offre ?
	 *
	 * ── UN PRIX ANNONCÉ EST UNE OFFRE, ET UN PRODUIT RETIRÉ N'EN FAIT PAS ─────
	 *
	 * `Product::garment_of()` dit « le studio sait l'habiller ». Il ne dit pas
	 * « on peut l'acheter ». Trois entrées de cette classe ne regardaient que la
	 * première : la reprise de la fiche, le prix de la vignette, et les données
	 * structurées envoyées à Google.
	 *
	 * Trouvé par la passe adversariale du 4 septembre 2026, sur la boutique
	 * réelle : « T-shirt personnalisé, coton bio », que `Gamme::retire()` venait
	 * de sortir de la vente en effaçant son prix, restait publié, visible dans le
	 * catalogue, et sa page annonçait « 14,95 EUR HT l'unité dès 50 pièces,
	 * impression comprise » avec un bouton « Personnaliser ce vêtement ». La
	 * seule chose qui manquait était la possibilité d'acheter. En France un prix
	 * annoncé engage, et ce fichier le dit déjà lui-même à propos d'un autre cas.
	 *
	 * `is_purchasable()` est la même question que le panier pose et que le
	 * portail de mise en ligne pose : une seule réponse, à un seul endroit.
	 */
	private static function may_quote( ?\WC_Product $product ): bool {
		return $product instanceof \WC_Product
			&& '' !== Product::garment_of( $product->get_id() )
			&& $product->is_purchasable();
	}

	public static function structured_data( array $markup, $product ): array {
		if ( ! $product instanceof \WC_Product ) {
			return $markup;
		}
		if ( ! self::may_quote( $product ) ) {
			unset( $markup['offers'] );
			return $markup;
		}
		$garment = Product::garment_of( $product->get_id() );

		$headline = self::headline( $garment, self::self_serve_cap( $product ) );
		if ( empty( $headline['best'] ) || empty( $headline['unit'] ) ) {
			// No self-serve price to publish. Saying nothing beats publishing the
			// blank's cost basis as though it were an offer.
			unset( $markup['offers'] );
			return $markup;
		}

		$config = Settings::pricing();

		$markup['offers'] = array(
			array(
				'@type'         => 'AggregateOffer',
				'lowPrice'      => Money::to_eur( (int) $headline['best']['unit_ttc'] ),
				'highPrice'     => Money::to_eur( (int) $headline['unit']['unit_ttc'] ),
				'priceCurrency' => (string) $config['currency'],
				'availability'  => 'https://schema.org/InStock',
				'offerCount'    => count( Pricing::grid_qtys( $config ) ),
				'url'           => $product->get_permalink(),
			),
		);

		return $markup;
	}

	/**
	 * Claim the parts of the summary this plugin owns, for this request only.
	 *
	 * Registered on `wp` rather than at load: `remove_action` here would
	 * otherwise take Woo's add-to-cart off every product in the shop, including
	 * the blanks the shop may also sell. It also keeps the admin's own view of
	 * the hook table untouched, which is what Compat::check reads.
	 */
	public static function take_over(): void {
		if ( ! function_exists( 'is_product' ) || ! is_product() ) {
			return;
		}

		$product_id = (int) get_queried_object_id();
		if ( ! self::may_quote( wc_get_product( $product_id ) ) ) {
			return;
		}

		remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_add_to_cart', 30 );

		add_action( 'woocommerce_single_product_summary', array( self::class, 'buy_box' ), 30 );
		add_action( 'woocommerce_single_product_summary', array( self::class, 'specs' ), 35 );
		add_action( 'woocommerce_after_single_product_summary', array( self::class, 'price_grid' ), 5 );
		// Priority 12 puts the devis after WooCommerce's description tabs (10)
		// and before its up-sells (15) and related products (20). It was on
		// `woocommerce_after_single_product` first, which is the emptiest hook
		// on the page and looked like the tidy choice, but that fires below the
		// cross-sell: a buyer scrolling for a quote met four other products
		// first.
		add_action( 'woocommerce_after_single_product_summary', array( self::class, 'quote_block' ), 12 );

		/*
		 * L'ÉDITEUR EST DANS LA FENTE D'AJOUT AU PANIER, où l'oeil de l'acheteur
		 * est déjà, et il n'y a plus de seconde page.
		 *
		 * `?personnaliser=1` ouvrait le studio encadré sur une vue séparée : un
		 * rechargement complet, une seconde adresse à ne pas indexer, et un
		 * cadre qui ne savait même pas quel produit venait d'être cliqué. Il n'y
		 * a plus qu'un écran, et `Editeur::rendre()` le pose depuis
		 * `product-cta.php`.
		 */
		/*
		 * ─────────────────────────────────────────────────────────────────────
		 * LA FICHE NE CHARGE PLUS L'ÉDITEUR, PARCE QU'ELLE NE PEUT PLUS LE
		 * MONTER.
		 *
		 * Depuis que le personnalisateur a sa page, ce gabarit ne rend plus
		 * aucun conteneur : le module descendait, se parsait, ne trouvait rien
		 * et s'arrêtait. Mesuré sur le HTML servi le 9 septembre 2026 : zéro
		 * occurrence de `data-teeshoop-editeur`, mais un `editeur-*.js`, un
		 * `editeur-*.css` et 3 576 octets de contexte en ligne, nonce compris.
		 *
		 * Ce que le retrait rend, mesuré sur deux séries de cinq dans les deux
		 * ordres : 113 088 et 113 174 octets de moins sur le fil (-19,2 %) et
		 * cinq requêtes de moins. Aucun gain de LCP n'est revendiqué : sur ce
		 * miroir la variance écrase l'écart et le signe s'inverse entre les
		 * deux séries, parce que l'élément le plus grand de cette page est le
		 * bandeau de consentement, qui peint avant l'arrivée du module.
		 *
		 * `Atelier::assets()` fait déjà l'appel là où il sert, et le geste
		 * symétrique dans l'autre sens en retirant le script de la fiche.
		 */

		self::enqueue();
	}

	private static function enqueue(): void {
		wp_enqueue_style( 'teeshoop-product', TEESHOOP_CORE_URL . 'assets/product.css', array( 'teeshoop-components' ), asset_version( 'assets/product.css' ) );
		wp_enqueue_script( 'teeshoop-product', TEESHOOP_CORE_URL . 'assets/product.js', array(), asset_version( 'assets/product.js' ), true );

		$config = Settings::pricing();
		wp_localize_script(
			'teeshoop-product',
			'TEESHOOP_PRODUCT',
			array(
				// Built with URL() on the other side, never by concatenating a
				// '?': with plain permalinks restUrl already carries one, and a
				// second turns every quote into a 404. Measured 2026-08-14.
				'restUrl'    => esc_url_raw( rest_url( 'teeshoop/v1/' ) ),
				'garment'    => Product::garment_of( (int) get_queried_object_id() ),
				'maxQty'     => (int) $config['max_qty'],
				'quoteFrom'  => (int) $config['quote_from_qty'],
				// Every sentence the estimator can print. product.js authors no
				// French of its own: a second place for copy is a second place
				// for it to drift out of the translator's reach.
				'i18n'       => array(
					'failed'   => __( 'Le prix n’a pas pu être calculé. Rechargez la page, puis réessayez.', 'teeshoop' ),
					'face'     => __( '%s face imprimée', 'teeshoop' ),
					'faces'    => __( '%s faces imprimées', 'teeshoop' ),
					// Both plural forms, because the noun is part of the
					// sentence: replacing only the digit printed "45 pièce".
					'one'      => __( '%s pièce, %s', 'teeshoop' ),
					'many'     => __( '%s pièces, %s', 'teeshoop' ),
					'unit'     => __( 'soit %s l’unité', 'teeshoop' ),
					'discount' => __( 'remise de %s % comprise', 'teeshoop' ),
				),
			)
		);
	}

	// -----------------------------------------------------------------------
	// What the customer asked for, read from the request and never trusted.
	// -----------------------------------------------------------------------

	/**
	 * The estimator's inputs.
	 *
	 * Nothing here is a price input in the payable sense, since `Cart::add` re-derives
	 * everything from the product and the stored design, but it still decides
	 * what a page tells a buyer, so it is bounded the same way: quantities are
	 * integers within the shop's own cap, faces cannot exceed what the garment
	 * has, and a size key that is not a size is dropped rather than echoed.
	 *
	 * @return array{qty:int,faces:int,grid:array<string,int>,mode:string}
	 */
	public static function request( string $garment, array $config ): array {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- a public GET form that reads nothing and writes nothing.
		$max   = (int) $config['max_qty'];
		$sizes = self::size_ids( $garment );

		$grid = array();
		$raw  = isset( $_GET['tailles'] ) && is_array( $_GET['tailles'] ) ? wp_unslash( $_GET['tailles'] ) : array();
		foreach ( $raw as $size => $count ) {
			$size  = strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', (string) $size ) ?? '' );
			$count = (int) $count;
			if ( '' !== $size && $count > 0 && in_array( $size, $sizes, true ) ) {
				$grid[ $size ] = min( $count, $max );
			}
		}

		/*
		 * THE SUBMITTED MODE WINS, and the heuristic is only the fallback.
		 *
		 * The size pane is hidden with the HTML `hidden` attribute, which hides
		 * inputs but does not stop the browser submitting them (only `disabled`
		 * does). So a no-JavaScript customer who filled the grid, then chose
		 * "Une seule taille" and typed 12, submitted both, and the old rule
		 * (grid wins whenever the grid is non-empty) priced the grid and threw
		 * away the choice they had just made.
		 */
		$sent = isset( $_GET['mode'] ) ? sanitize_key( wp_unslash( (string) $_GET['mode'] ) ) : '';
		$mode = in_array( $sent, array( 'single', 'grid' ), true )
			? $sent
			: ( ! empty( $grid ) ? 'grid' : 'single' );

		if ( 'single' === $mode ) {
			$grid = array();
		}

		$typed = 'grid' === $mode && ! empty( $grid )
			? (int) array_sum( $grid )
			: max( 1, (int) ( $_GET['qte'] ?? 1 ) );

		$faces     = max( 1, (int) ( $_GET['faces'] ?? 1 ) );
		$max_faces = Garments::printable_sides_count( $garment );

		/*
		 * PAST THE CAP THE PAGE STOPS PRICING, it does not quietly reduce.
		 *
		 * Clamping the sum to max_qty printed two different numbers on the same
		 * screen: the size pane said "Total 30 000 pièces" and the estimate
		 * beside it said "10 000 pièces, 94 200,00 EUR HT", for a run
		 * `Cart::add` refuses outright. Which is exactly the mistake the cart
		 * already refuses to make (Cart.php: "REFUSED, not clamped").
		 */
		$over_cap = $typed > $max;
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		return array(
			'qty'      => max( 1, min( $typed, $max ) ),
			'typed'    => max( 1, $typed ),
			'over_cap' => $over_cap,
			'faces'    => min( $faces, $max_faces ),
			'grid'     => $grid,
			'mode'     => $mode,
		);
	}

	/**
	 * The size a single-size run is in.
	 *
	 * The pane used to ask only "how many", and the answer travelled into the
	 * editor as a bare quantity, where the basket panel turned it into "40 of
	 * whatever size the 3D preview happened to be showing". That is a size the
	 * buyer never chose, on forty garments. The pane asks now, so what crosses
	 * the boundary is always a real breakdown.
	 */
	public static function requested_size( string $garment ): string {
		$sizes = self::size_ids( $garment );
		if ( empty( $sizes ) ) {
			return '';
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a public GET form.
		$raw = isset( $_GET['taille'] ) ? strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', (string) wp_unslash( $_GET['taille'] ) ) ?? '' ) : '';
		if ( in_array( $raw, $sizes, true ) ) {
			return $raw;
		}
		// M by default, because it is the most ordered adult size and the size
		// every published area and every priced area is already measured at.
		$priced = Garments::priced_size( $garment );
		return in_array( $priced, $sizes, true ) ? $priced : $sizes[0];
	}

	/** The sizes this garment is offered in, from the studio's own chart. */
	public static function size_ids( string $garment ): array {
		$out = array();
		foreach ( Garments::sizes( $garment ) as $row ) {
			$id = (string) ( $row['size'] ?? '' );
			if ( '' !== $id ) {
				$out[] = $id;
			}
		}
		return $out;
	}


	/**
	 * Les permutations de l'estimateur ne s'indexent pas : un produit, pas
	 * quarante adresses presque identiques.
	 *
	 * `?personnaliser=1` a disparu de cette liste avec le studio encadré : il
	 * n'y a plus de seconde page à ne pas indexer, l'éditeur est dans la fiche.
	 * Les six autres restent parce que l'estimateur sans JavaScript recharge
	 * toujours la page avec ses réponses dans l'adresse.
	 */
	public static function robots( array $robots ): array {
		if ( ! function_exists( 'is_product' ) || ! is_product() ) {
			return $robots;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading the URL shape, not acting on it.
		$noisy = isset( $_GET['qte'] ) || isset( $_GET['tailles'] ) || isset( $_GET['faces'] )
			|| isset( $_GET['taille'] ) || isset( $_GET['mode'] ) || isset( $_GET['devis'] );
		if ( $noisy ) {
			$robots['noindex'] = true;
			$robots['follow']  = true;
		}
		return $robots;
	}

	// -----------------------------------------------------------------------
	// Price display
	// -----------------------------------------------------------------------

	/**
	 * Les deux ancres, en cache par (vêtement, borne d'expédition) pour la durée
	 * de la requête.
	 *
	 * LA BORNE FAIT PARTIE DE LA CLÉ. Le cache était par vêtement seul, et une
	 * archive de vingt-quatre fiches où deux sweats n'ont pas le même poids
	 * aurait servi à la deuxième l'ancre calculée pour la première. Une
	 * accroche de prix lue sur un autre produit est exactement le défaut que
	 * `Pricing::headline` existe pour empêcher.
	 */
	public static function headline( string $garment, ?int $self_serve_max = null ): array {
		$key = $garment . '|' . ( null === $self_serve_max ? 'aucune' : (string) $self_serve_max );
		if ( ! isset( self::$headlines[ $key ] ) ) {
			$config = Settings::pricing();
			self::$headlines[ $key ] = isset( $config['garments'][ $garment ] )
				? Pricing::headline( $garment, $config, $self_serve_max )
				: array();
		}
		return self::$headlines[ $key ];
	}

	/**
	 * Combien de pièces de CE produit un colis porte, ou null si on ne sait pas.
	 *
	 * Null se propage jusqu'à `Pricing::headline()`, où il vaut « aucune borne ».
	 * Ce n'est PAS ce qu'un poids inconnu doit produire : voir `self_serve_cap()`.
	 */
	public static function self_serve_max( ?\WC_Product $product ): ?int {
		return Shipping::max_pieces( self::unit_grams( $product ), Shipping::config() );
	}

	/**
	 * La borne à donner à l'accroche de prix, poids inconnu compris.
	 *
	 * UN POIDS INCONNU BORNE À ZÉRO, il ne débride pas. `Shipping::quote()`
	 * répond `NO_WEIGHT` sur un tel produit et la caisse n'a aucun tarif de
	 * livraison : pas une pièce n'est expédiable, donc aucune quantité n'est
	 * publiable. `grid_rows()` prend déjà cette lecture ; c'est l'accroche qui
	 * prenait l'autre et publiait un prix par-dessus un tableau entièrement
	 * « sur devis ».
	 */
	public static function self_serve_cap( ?\WC_Product $product ): int {
		return self::self_serve_max( $product ) ?? 0;
	}

	/**
	 * Replace the catalogue price with one a customer can actually reach.
	 *
	 * "À partir de X" with no quantity beside it is the lie Mistertee prints:
	 * their headline is the 500-piece price, so a buyer of twenty finds a 36 %
	 * gap by scrolling. The quantity is therefore part of the sentence, and both
	 * the figure and the quantity come out of `Pricing::headline`, which reads
	 * them from the grid printed further down the same page.
	 */
	public static function price_html( string $html, $product ): string {
		if ( ! $product instanceof \WC_Product ) {
			return $html;
		}
		if ( ! self::may_quote( $product ) ) {
			return $html;
		}
		$garment = Product::garment_of( $product->get_id() );

		$headline = self::headline( $garment, self::self_serve_cap( $product ) );
		if ( empty( $headline['best'] ) ) {
			return $html;
		}

		$best = $headline['best'];

		/*
		 * ONE NUMBER WHEN THERE IS ONE NUMBER. Under the franchise this line
		 * printed "9,42 EUR HT (9,42 EUR TTC)": the same amount twice, with a
		 * parenthesis that invites the reader to look for a tax that must not
		 * exist. Both the decision and the writing of it live in `Settings`,
		 * because the homepage, the listing card and the entreprises page print
		 * the same sentence and four copies of it would eventually disagree.
		 */
		$pair = Settings::price_pair( (int) $best['unit_ht'], (int) $best['unit_ttc'] );

		return sprintf(
			'<span class="teeshoop-price">%s <span class="teeshoop-price__ttc">%s</span> <span class="teeshoop-price__from">%s</span></span>',
			esc_html( $pair['lead'] ),
			esc_html( $pair['second'] ),
			esc_html(
				sprintf(
					/* translators: %d: the quantity at which that unit price is reached. */
					__( 'l’unité dès %d pièces, impression comprise', 'teeshoop' ),
					(int) $best['qty']
				)
			)
		);
	}

	/**
	 * Le bouton d'une vignette de catalogue mène à l'atelier, pas au panier.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * IL MÈNE À L'ATELIER ET PLUS À LA FICHE, DEPUIS LE 9 SEPTEMBRE 2026.
	 *
	 * Un vêtement personnalisable n'a rien à ajouter au panier tant qu'aucun
	 * visuel n'a été posé, donc « Ajouter au panier » n'est pas une phrase vraie
	 * sur cette vignette. Il menait à la fiche produit, où l'éditeur était en
	 * ligne ; il mène maintenant directement à l'atelier, qui est ce que le
	 * visiteur veut faire quand il clique sur « Personnaliser ».
	 *
	 * ET IL RETOMBE SUR LA FICHE SI L'ATELIER NE PEUT PAS SERVIR. Un lien vers
	 * une page qui refusera est pire qu'un lien vers une page qui informe :
	 * `verify:vendable` a déjà compté une ancre « Personnaliser » comme un
	 * chemin d'achat jusqu'à ce qu'il aille voir derrière.
	 */
	public static function loop_link( string $html, $product ): string {
		if ( ! $product instanceof \WC_Product || '' === Product::garment_of( $product->get_id() ) ) {
			return $html;
		}
		$atelier = 'pret' === Atelier::etat( $product->get_id() ) ? Atelier::url( $product->get_id() ) : '';
		return sprintf(
			'<a href="%s" class="button teeshoop-loop-cta">%s</a>',
			esc_url( '' !== $atelier ? $atelier : $product->get_permalink() ),
			esc_html__( 'Personnaliser', 'teeshoop' )
		);
	}

	// -----------------------------------------------------------------------
	// The lock
	// -----------------------------------------------------------------------

	/**
	 * Refuse any add-to-cart for a personalisable product that carries no design.
	 *
	 * `Cart::add` calls `WC_Cart::add_to_cart()` directly, and that method does
	 * NOT apply this filter on WooCommerce 11.0.1 (the filter lives in the form
	 * handler, the AJAX handler, the Store API controller and the reorder path).
	 * So the editor's own path is untouched and needs no exemption. The
	 * `teeshoop` key is still checked, because the reorder path and the session
	 * restore both pass `$cart_item_data` and a future Woo may pass it here too.
	 *
	 * "Commander à nouveau" is refused on purpose and is the interesting case:
	 * `woocommerce_order_again_cart_item_data` defaults to an empty array, so a
	 * reorder of a personalised line would put a plain garment in the basket at
	 * the catalogue price, with no artwork for the workshop and no way for
	 * anyone to notice. Réassort is a real feature and it is session 06's; until
	 * it exists, refusing is the honest answer.
	 *
	 * @param bool  $passed         Validation so far.
	 * @param int   $product_id     Product being added.
	 * @param int   $quantity       Quantity.
	 * @param int   $variation_id   Variation, if any.
	 * @param array $variations     Variation attributes.
	 * @param array $cart_item_data Item data, when the caller passes it.
	 */
	public static function refuse_plain_add( $passed, $product_id, $quantity = 0, $variation_id = 0, $variations = array(), $cart_item_data = array() ) {
		if ( ! $passed ) {
			return $passed;
		}
		if ( is_array( $cart_item_data ) && isset( $cart_item_data['teeshoop'] ) ) {
			return $passed;
		}
		if ( '' === Product::garment_of( (int) $product_id ) ) {
			return $passed;
		}

		if ( function_exists( 'wc_add_notice' ) ) {
			wc_add_notice(
				sprintf(
					'%s <a href="%s">%s</a>',
					esc_html__( 'Ce vêtement se commande une fois votre visuel placé.', 'teeshoop' ),
					esc_url( get_permalink( (int) $product_id ) ?: home_url( '/' ) ),
					esc_html__( 'Personnaliser', 'teeshoop' )
				),
				'error'
			);
		}
		return false;
	}

	// -----------------------------------------------------------------------
	// Blocks
	// -----------------------------------------------------------------------


	/** Quantity, faces, the live total and the two ways forward. */
	public static function buy_box(): void {
		$product_id = (int) get_queried_object_id();
		$garment    = Product::garment_of( $product_id );
		$config     = Settings::pricing();
		$request    = self::request( $garment, $config );

		$quote = Pricing::quote(
			array(
				'garment' => $garment,
				'qty'     => $request['qty'],
				'sides'   => Pricing::standard_sides( $request['faces'] ),
			),
			$config
		);

		wc_get_template(
			'teeshoop/product-cta.php',
			array(
				'product_id'  => $product_id,
				'garment'     => $garment,
				'config'      => $config,
				'request'     => $request,
				'quote'       => $quote,
				'headline'    => self::headline( $garment, self::self_serve_cap( wc_get_product( $product_id ) ) ),
				'sizes'       => self::size_ids( $garment ),
				'max_faces'   => Garments::printable_sides_count( $garment ),
				'size'        => self::requested_size( $garment ),
				/*
				 * LA MÊME RÉPONSE QUE LA GRILLE ET QUE LE PANIER.
				 *
				 * Cet encadré lisait `Pricing::needs_quote` seul, qui connaît la
				 * quantité et le montant et pas le poids. Mesuré le 4 septembre
				 * 2026 : sur la fiche d'un sweat, la grille imprimait « sur
				 * devis » à cinquante pièces pendant que cet encadré, DIX
				 * CENTIMÈTRES PLUS HAUT, imprimait « 1 267,50 EUR HT, soit
				 * 25,35 EUR l'unité » et laissait « Personnaliser » en action
				 * principale. Trois surfaces, trois réponses, sur une commande
				 * que la caisse ne sait pas expédier.
				 */
				'needs_quote' => Pricing::needs_quote( $request['qty'], (int) $quote['total_ht'], $config )
					|| $request['qty'] > self::self_serve_cap( wc_get_product( $product_id ) ),
				/*
				 * LE PAQUET DE L'ÉDITEUR EXISTE-T-IL, ce qui décide si la fiche
				 * peut proposer l'atelier ou seulement le devis.
				 *
				 * CE COMMENTAIRE DISAIT AUTRE CHOSE ET IL ÉTAIT PÉRIMÉ : il
				 * décrivait un éditeur dans cette page, portant la grille de
				 * tailles, le prix et le bouton d'achat. Depuis que le
				 * personnalisateur a sa page, ce gabarit ne pose plus que le
				 * lien. Le nom du drapeau est gardé parce que le gabarit le lit
				 * sous ce nom.
				 *
				 * UNE SEULE CONDITION, ET LA MÊME QUE CELLE QUI DÉCIDE DE
				 * L'ENQUEUE. Il y en a eu deux pendant une heure, `est_actif()`
				 * ici et `paquet_present()` là-bas, et la passe adversariale a
				 * écrit la chaîne : une boutique sans l'option publiait le
				 * script et le nonce pour un conteneur jamais rendu, et perdait
				 * son bouton d'achat. Deux portes pour une question, c'est la
				 * configuration où aucune des deux n'est celle qu'on croit.
				 */
				'editeur_natif' => Editeur::paquet_present(),
				/*
				 * L'ATELIER EST UNE PAGE, ET LA FICHE Y MÈNE.
				 *
				 * Vide quand l'atelier ne peut pas servir ce produit, et le
				 * gabarit retombe alors sur le devis. Une seule condition,
				 * `Atelier::etat()`, pour la même raison que ci-dessus : deux
				 * portes pour une question, c'est la configuration où aucune
				 * des deux n'est celle qu'on croit.
				 */
				'atelier_url'   => 'pret' === Atelier::etat( $product_id ) ? Atelier::url( $product_id ) : '',
			),
			'',
			TEESHOOP_CORE_DIR . 'templates/'
		);
	}

	/** Colours, sizes, print areas: the facts, in centimetres. */
	public static function specs(): void {
		$product_id = (int) get_queried_object_id();
		$garment    = Product::garment_of( $product_id );

		wc_get_template(
			'teeshoop/product-specs.php',
			array(
				'product_id'  => $product_id,
				'garment'     => $garment,
				'areas'       => Garments::areas( $garment ),
				'priced_size' => Garments::priced_size( $garment ),
				'colors'      => self::colours_for( $product_id ),
				'sizes'       => self::sizes_for( $product_id, $garment ),
				'brand_ref'   => self::sizes_source( $product_id, $garment ),
				'material'    => (string) get_post_meta( $product_id, Garments::META_MATERIAL, true ),
				'weight_gsm'  => (int) get_post_meta( $product_id, Garments::META_WEIGHT, true ),
				'brand'       => (string) get_post_meta( $product_id, Garments::META_BRAND, true ),
				'brand_code'  => (string) get_post_meta( $product_id, Garments::META_BRAND_REF, true ),
				'specs_date'  => (string) get_post_meta( $product_id, Garments::META_SPECS_DATE, true ),
			),
			'',
			TEESHOOP_CORE_DIR . 'templates/'
		);
	}

	/**
	 * Les coloris que CETTE référence a, pas les dix-huit du studio.
	 *
	 * ── CE QUE LA PAGE DISAIT AVANT LE 4 SEPTEMBRE 2026 ────────────────────────
	 *
	 * `Garments::colors()` est la liste du STUDIO : dix-huit teintures inventées
	 * pour une démonstration, avec leurs noms français (« Menthe », « Sable »,
	 * « Vert gazon »). Elles étaient imprimées sur chaque fiche personnalisable,
	 * quelle que soit la référence. Le B&C #E150 annonçait donc dix-huit coloris
	 * dont le fournisseur ne vend qu'une partie, sous des noms qui ne figurent
	 * sur aucune de ses factures.
	 *
	 * `Gamme::palette()` a écrit sur le produit le nuancier DÉRIVÉ des pastilles
	 * mesurées de cette référence (`Product::META_BLANK_PALETTE`) : le nom du
	 * fabricant et sa couleur mesurée. C'est ce que la fiche montre désormais.
	 *
	 * La liste du studio reste le repli, et elle est juste dans ce cas-là : un
	 * produit qui ne déclare aucun textile nu est un vêtement que NOUS
	 * fournissons, et ces teintures sont alors les nôtres.
	 *
	 * @return array<int,array{name:string,hex:string}>
	 */
	public static function colours_for( int $product_id ): array {
		$palette = Product::blank_palette_of( $product_id );
		if ( array() === $palette ) {
			return Garments::colors();
		}
		$out = array();
		foreach ( $palette as $entry ) {
			$out[] = array(
				'name' => (string) $entry['name'],
				/*
				 * Le premier arrêt, pas un mélange : un chiné se dessine en deux
				 * teintes là où la surface le permet et par sa teinte dominante
				 * ailleurs, et la moyenne des deux est une couleur que le
				 * fournisseur ne vend pas.
				 */
				'hex'  => (string) $entry['stops'][0],
			);
		}
		return $out;
	}

	/**
	 * La grille de tailles de CETTE référence, quand le fabricant l'a publiée.
	 *
	 * ── LE CHIFFRE FAUX QUE CETTE FONCTION RETIRE ─────────────────────────────
	 *
	 * La fiche imprimait `Garments::sizes( $garment )`, c'est-à-dire la charte du
	 * STUDIO, sous une légende qui nommait la référence du produit. Mesuré le
	 * 4 septembre 2026 sur le B&C #E150 : la page publiait 52,0 cm de
	 * demi-poitrine en M, là où la fiche de mesures de B&C dit 50. Deux
	 * centimètres d'erreur, sur la page où un acheteur professionnel choisit sa
	 * taille, sous le nom du fabricant.
	 *
	 * `scripts/zones-mesurer.mjs` lit maintenant la fiche du fabricant et écrit
	 * la série sur le produit. Quand elle est là, c'est elle qui est publiée.
	 *
	 * ── ET LES DEUX COLONNES QU'ON N'A PAS RESTENT VIDES ──────────────────────
	 *
	 * La fiche du fabricant ne donne que la demi-poitrine à cet endroit. La
	 * longueur et la manche ne sont PAS reprises de la charte du studio pour
	 * remplir le tableau : ce serait mélanger les mesures de deux vêtements dans
	 * une même ligne, ce qui est pire qu'une colonne vide. `CLAUDE.md` section 7 :
	 * si la donnée n'existe pas, on construit l'état vide.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public static function sizes_for( int $product_id, string $garment ): array {
		$maker = self::maker_half_chest( $product_id );
		if ( array() === $maker ) {
			return Garments::sizes( $garment );
		}
		$out = array();
		foreach ( $maker as $size => $cm ) {
			$out[] = array(
				'size'            => (string) $size,
				'halfChestCm'     => (float) $cm,
				'bodyLengthCm'    => 0.0,
				'sleeveLengthCm'  => 0.0,
			);
		}
		return $out;
	}

	/** What the size table is measured from, for its caption. */
	public static function sizes_source( int $product_id, string $garment ): string {
		if ( array() !== self::maker_half_chest( $product_id ) ) {
			$brand = trim( (string) get_post_meta( $product_id, Garments::META_BRAND, true ) );
			$code  = trim( (string) get_post_meta( $product_id, Garments::META_BRAND_REF, true ) );
			return trim( $brand . ' ' . $code );
		}
		return Garments::brand_ref( $garment );
	}

	/**
	 * La série du fabricant, pour la passerelle.
	 *
	 * Publique parce que `Editeur::contexte()` la publie vers l'éditeur, où elle
	 * décide du gradient d'impression, et parce que `Cart::add` la relit pour
	 * refuser une taille où le marquage ne tiendrait pas sur le film. Même
	 * lecture, même garde-fou d'unité : une seule maison pour « quelle est la
	 * vraie demi-poitrine ».
	 *
	 * @return array<string,float>
	 */
	public static function maker_chart( int $product_id ): array {
		return self::maker_half_chest( $product_id );
	}

	/**
	 * The maker's own half-chest series, size => cm, or an empty array.
	 *
	 * @return array<string,float>
	 */
	private static function maker_half_chest( int $product_id ): array {
		if ( $product_id <= 0 ) {
			return array();
		}
		$raw = json_decode( (string) get_post_meta( $product_id, '_teeshoop_demi_poitrine', true ), true );
		if ( ! is_array( $raw ) ) {
			return array();
		}
		$out = array();
		foreach ( $raw as $size => $cm ) {
			$size = strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', (string) $size ) ?? '' );
			/*
			 * Une demi-poitrine hors de cette plage n'est pas une demi-poitrine :
			 * c'est une lecture ratée de la fiche PDF, ou un tableau en pouces.
			 * Le même garde-fou que `zones-mesurer.mjs` applique à l'écriture,
			 * appliqué de nouveau à la lecture, parce que ce nombre atteint un
			 * client qui choisit sa taille dessus.
			 */
			if ( '' !== $size && is_numeric( $cm ) && (float) $cm >= 25 && (float) $cm <= 95 ) {
				$out[ $size ] = (float) $cm;
			}
		}
		return $out;
	}

	/**
	 * Le poids d'une pièce en grammes, ou 0 quand il est inconnu.
	 *
	 * ZÉRO EST « ON N'A PAS PU PESER », jamais « ça ne pèse rien ».
	 * `WC_Product::get_weight()` rend '' pour un produit dont personne n'a saisi
	 * le poids, et le lire comme 0 g mettrait chaque colis dans la tranche la
	 * plus légère, donc la moins chère, de la grille Colissimo. C'est la même
	 * distinction que `Shipping::NO_WEIGHT` fait au moment d'affranchir.
	 */
	private static function unit_grams( ?\WC_Product $product ): int {
		if ( ! $product instanceof \WC_Product ) {
			return 0;
		}
		$weight = $product->get_weight();
		if ( '' === $weight || null === $weight || ! is_numeric( $weight ) || (float) $weight <= 0 ) {
			return 0;
		}
		return (int) round( (float) wc_get_weight( (float) $weight, 'g' ) );
	}

	/**
	 * La grille du prix authority, MOINS les colonnes que la boutique ne sait
	 * pas servir.
	 *
	 * `Pricing::grid()` marque déjà « sur devis » les cellules au-delà du seuil
	 * d'autonomie, parce qu'elle connaît la quantité et le montant. Elle ne
	 * connaît pas le POIDS : elle est pure par construction et n'a ni
	 * transporteur ni balance. Mesuré le 4 septembre 2026, un sweat dont la
	 * déclinaison la plus lourde pèse 0,7 kg publiait un prix à cinquante pièces
	 * pour un colis de 35 kg, cinq de plus que la grille Colissimo ne sait
	 * affranchir : le client mettait la ligne au panier et arrivait à une caisse
	 * sans mode de livraison.
	 *
	 * La règle combinée vit ICI et nulle part ailleurs, et
	 * `tests/integration-grille.php` l'appelle plutôt que d'en tenir une
	 * deuxième copie : un garde qui décide autrement que la page qu'il garde ne
	 * garde rien.
	 *
	 * @param int $unit_g Le poids d'une pièce en grammes, 0 quand il est inconnu.
	 * @return array<int,array<string,mixed>>
	 */
	public static function grid_rows( string $garment, array $config, int $unit_g ): array {
		$rows = Pricing::grid(
			$garment,
			Pricing::grid_qtys( $config ),
			range( 1, Garments::printable_sides_count( $garment ) ),
			$config
		);

		$max = Shipping::max_pieces( $unit_g, Shipping::config() );
		if ( null === $max || $max <= 0 ) {
			/*
			 * Un produit sans poids ne se sert pas du tout : `Shipping::quote`
			 * répond `no_weight` et la caisse n'a pas de tarif. Toutes les
			 * colonnes passent sur devis plutôt qu'une seule, parce que la
			 * quantité n'y est pour rien.
			 */
			foreach ( $rows as $r => $row ) {
				foreach ( $row['cells'] as $c => $cell ) {
					$rows[ $r ]['cells'][ $c ]['needs_quote'] = true;
				}
			}
			return $rows;
		}

		foreach ( $rows as $r => $row ) {
			foreach ( $row['cells'] as $c => $cell ) {
				if ( (int) $cell['qty'] > $max ) {
					$rows[ $r ]['cells'][ $c ]['needs_quote'] = true;
				}
			}
		}
		return $rows;
	}

	/** Faces by quantity, HT and TTC, straight from the price authority. */
	public static function price_grid(): void {
		$product_id = (int) get_queried_object_id();
		$garment    = Product::garment_of( $product_id );
		$config     = Settings::pricing();
		$qtys       = Pricing::grid_qtys( $config );
		$product    = wc_get_product( $product_id );
		$unit_g     = self::unit_grams( $product );

		wc_get_template(
			'teeshoop/product-price-grid.php',
			array(
				'garment'  => $garment,
				'config'   => $config,
				'qtys'     => $qtys,
				'rows'     => self::grid_rows( $garment, $config, $unit_g ),
				'std_area' => Pricing::std_area_sq_cm( $config ),
				'request'  => self::request( $garment, $config ),
			),
			'',
			TEESHOOP_CORE_DIR . 'templates/'
		);
	}

	/** The devis path, for the jobs the self-serve page should not price alone. */
	public static function quote_block(): void {
		$product_id = (int) get_queried_object_id();
		$garment    = Product::garment_of( $product_id );
		$config     = Settings::pricing();

		wc_get_template(
			'teeshoop/product-quote.php',
			array(
				'product_id' => $product_id,
				'garment'    => $garment,
				'config'     => $config,
				'request'    => self::request( $garment, $config ),
				'sizes'      => self::size_ids( $garment ),
			),
			'',
			TEESHOOP_CORE_DIR . 'templates/'
		);
	}

}
