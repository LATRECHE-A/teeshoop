<?php
/**
 * The WordPress half of scripts/wp-e2e-verify.mjs.
 *
 *   docker compose -f wp-local/docker-compose.yml run --rm wpcli \
 *     eval-file wp-content/plugins/teeshoop-core/tests/e2e-support.php <mode> [args]
 *
 * Three modes, each printing ONE line of JSON on stdout so the harness can read
 * it without parsing prose:
 *
 *   setup <studio_origin> <worker_url>   configure the integration and make a
 *                                        product page carrying the shortcode
 *   cart <customer_id>                   what the visitor's stored session
 *                                        holds, and what Pricing::quote() says
 *                                        it should cost
 *   refuse <product_id> <design_id>      the fail-closed path, with a design id
 *                                        the Worker has never seen
 *
 * It lives here rather than in scripts/ because it has to be inside the plugin
 * directory the container bind-mounts, and it is deliberately NOT named
 * test-*.php: tests/run.php globs that pattern and must stay bootstrap-free.
 *
 * IT ASSERTS NOTHING. Every judgement is made in the harness, in Node, from the
 * JSON below. A support file that decided for itself whether the price was
 * right would be the price engine's third implementation.
 *
 * NOTE: no `declare(strict_types=1)`, unlike the rest of the plugin. `wp
 * eval-file` eval()s the contents and a declare must be the first statement of
 * a script; inside an eval it is a fatal error. Same reason integration.php
 * does without it.
 *
 * @package Teeshoop\Core
 */

/*
 * COMMAND LINE ONLY.
 *
 * `wp-content/plugins/` is served by URL and this directory is inside it.
 * Before this line, GET /wp-content/plugins/teeshoop-core/tests/run.php
 * answered 200 and ran the whole suite to the public internet: it names the
 * floor-price and commission rules, it prints the expected and actual figures
 * of any assertion that fails, and on shared hosting it burns the CPU of
 * whoever asks. The customer bundle is guarded against exactly this leak by
 * scripts/bundle-guard.mjs; the same material was reachable in PHP, and an
 * unguessable path is not an access control.
 *
 * PHP_SAPI rather than a WP_CLI check, because `php tests/run.php` runs with no
 * WordPress at all while the two integration files run under wp-cli, which is
 * also CLI. It must come after any `declare`, which has to be the first
 * statement of a script.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Cart;
use Teeshoop\Core\Editeur;
use Teeshoop\Core\Money;
use Teeshoop\Core\Pricing;
use Teeshoop\Core\ProductPage;
use Teeshoop\Core\Product;
use Teeshoop\Core\Settings;

/** The slug is fixed so the harness can be run twice without piling up products. */
const TS_E2E_SLUG = 'teeshoop-e2e-tee';

function ts_e2e_out( array $payload ) {
	echo wp_json_encode( $payload ) . "\n";
}

/**
 * A theme that renders WooCommerce the way production does.
 *
 * The shipped default is Twenty Twenty-Five, an FSE theme, and WooCommerce's
 * BLOCK product template puts the description through `wp_kses_post` after
 * expanding shortcodes. `iframe` is not an allowed tag there, so the studio
 * came out as an empty `<div class="teeshoop-studio">`: rendered, sanitised
 * away, and silent about it. teeshoop.com runs Woodmart, which is a classic
 * theme, and since session 09 so is ours: `teeshoop` is what the shop will
 * actually run, so it is what the harness switches TO. Twenty Twenty-One stays
 * behind it for a checkout that has not mounted `wp-themes/`.
 *
 * Worth carrying into session 02: on a block theme the studio cannot live in a
 * product description at all, whatever the shortcode does.
 */
function ts_e2e_classic_theme() {
	$active = wp_get_theme();
	if ( ! $active->is_block_theme() ) {
		return array( 'theme' => $active->get_stylesheet(), 'switched' => false );
	}
	foreach ( array( 'teeshoop', 'twentytwentyone' ) as $slug ) {
		if ( wp_get_theme( $slug )->exists() ) {
			switch_theme( $slug );
			return array( 'theme' => $slug, 'switched' => true );
		}
	}
	return array( 'theme' => $active->get_stylesheet(), 'switched' => false, 'need_classic' => true );
}

function ts_e2e_setup( string $studio_origin, string $worker_url ) {
	$theme = ts_e2e_classic_theme();

	/*
	 * A French shop, because that is what is being mirrored.
	 *
	 * WooCommerce ships as a USD store, and it renders the price the plugin
	 * hands it with the STORE's symbol: a 384,25 EUR line came out as $384.25
	 * on the cart page. Same digits, wrong money, all the way to the invoice.
	 * The plugin now says so in the admin; the mirror should simply be right.
	 */
	update_option( 'woocommerce_currency', 'EUR' );
	update_option( 'woocommerce_default_country', 'FR:IDF' );
	/*
	 * And a real 20 % rate, because the studio prints "TVA 20 % incluse".
	 *
	 * That caption comes from `teeshoop_pricing.vat_rate`; what a customer is
	 * charged comes from WooCommerce's own tax tables, and the mirror shipped
	 * with taxes enabled and ZERO rows. So the panel said 326,10 EUR TTC and the
	 * cart said 271,75 EUR with no tax, 54,35 EUR apart, on a caption the invoice
	 * would contradict. Two VAT implementations that nothing reconciled. The
	 * harness now asserts the cart total against the quote's TTC, which is only
	 * meaningful once the shop actually has the rate it claims.
	 */
	global $wpdb;
	$wpdb->query( "DELETE FROM {$wpdb->prefix}woocommerce_tax_rates WHERE tax_rate_name = 'TVA'" );
	/*
	 * Derived, not typed. A harness that asserts the cart total against the
	 * quote's TTC while writing its own idea of the rate would agree with itself
	 * and with nothing else, which is the failure the comment above describes.
	 */
	\WC_Tax::_insert_tax_rate(
		array(
			'tax_rate_country'  => 'FR',
			'tax_rate'          => number_format( (float) \Teeshoop\Core\Settings::pricing()['vat_rate'] * 100, 4, '.', '' ),
			'tax_rate_name'     => 'TVA',
			'tax_rate_priority' => 1,
			'tax_rate_shipping' => 1,
			'tax_rate_class'    => '',
		)
	);
	update_option( 'woocommerce_currency_pos', 'right_space' );
	// Grams, because the carriage grid is. WooCommerce ships as `lbs`, which
	// turns a 180 g t-shirt entered as 0,18 into 82 g and four bracket steps.
	update_option( 'woocommerce_weight_unit', 'kg' );

	/*
	 * A DELIVERY ZONE AND A WAY TO PAY, because a checkout that offers neither
	 * cannot be walked through. Virement (BACS) is the one core gateway that
	 * takes no keys and behaves like a real French payment: the order lands
	 * `on-hold` and only becomes `processing` when the shop confirms the funds
	 * arrived. That is also the case a listener on `woocommerce_payment_complete`
	 * alone would never see, which is exactly why the harness uses it.
	 */
	$has_zone = false;
	foreach ( \WC_Shipping_Zones::get_zones() as $zone ) {
		foreach ( (array) ( $zone['shipping_methods'] ?? array() ) as $method ) {
			if ( \Teeshoop\Core\Shipping::METHOD_ID === $method->id ) {
				$has_zone = true;
			}
		}
	}
	if ( ! $has_zone ) {
		$zone = new \WC_Shipping_Zone();
		$zone->set_zone_name( 'France métropolitaine' );
		$zone->add_location( 'FR', 'country' );
		$zone->save();
		$zone->add_shipping_method( \Teeshoop\Core\Shipping::METHOD_ID );
		$zone->save();
		\WC_Cache_Helper::get_transient_version( 'shipping', true );
	}

	$bacs = get_option( 'woocommerce_bacs_settings', array() );
	if ( ! is_array( $bacs ) ) {
		$bacs = array();
	}
	$bacs['enabled'] = 'yes';
	$bacs['title']   = 'Virement bancaire';
	update_option( 'woocommerce_bacs_settings', $bacs );
	update_option( 'woocommerce_price_decimal_sep', ',' );
	update_option( 'woocommerce_price_thousand_sep', ' ' );

	/*
	 * PLUS DE DRAPEAU À ALLUMER : l'éditeur est le seul chemin, et il est là dès
	 * que son paquet construit est dans le greffon. `studio_origin` reste
	 * renseigné parce que la page d'atelier (`ProductionPage`) y envoie encore
	 * l'opérateur ; ce n'est plus une origine que le client voit.
	 */
	update_option(
		'teeshoop_settings',
		array(
			'studio_origin'      => $studio_origin,
			'studio_path'        => '/',
			'worker_url'         => $worker_url,
			'design_verify_path' => '/api/design/',
		)
	);

	$existing = get_page_by_path( TS_E2E_SLUG, OBJECT, 'product' );
	$product  = $existing ? wc_get_product( $existing->ID ) : new WC_Product_Simple();

	$product->set_name( 'Tee de vérification' );
	$product->set_slug( TS_E2E_SLUG );
	$product->set_status( 'publish' );
	$product->set_catalog_visibility( 'hidden' );
	// A catalogue price that must NEVER be charged: every assertion downstream
	// compares against Pricing::quote(), so a leak of this number is visible.
	$product->set_regular_price( '99.99' );
	// The short description: WooCommerce's classic summary template runs it
	// through `do_shortcode`, and it puts the editor high on the page where a
	// personalisation tool belongs rather than inside the description tab.
	/*
	 * PLUS DE RACCOURCI DANS LA DESCRIPTION : l'éditeur est posé par
	 * `product-cta.php` dans la fente d'ajout au panier, sur toute fiche dont le
	 * produit déclare un vêtement. Le contournement du thème de blocs
	 * (`ts_e2e_classic_theme`) reste : ce n'est plus `wp_kses_post` qui l'impose
	 * (il n'y a plus d'iframe à retirer) mais les crochets de la fente d'achat,
	 * que la production a et qu'un gabarit de blocs ne fournit pas.
	 */
	$product->set_short_description( '' );
	/*
	 * A FIXTURE WEIGHT, and nothing else reads it. Carriage is priced from the
	 * supplier's own per-SKU weight and `Shipping::quote` refuses a line that
	 * has none rather than assuming one; this exists so the checkout has
	 * something to weigh.
	 */
	$product->set_weight( '0.18' );
	$product->set_description( 'Un t-shirt personnalisable, pour la vérification de bout en bout.' );
	$product->update_meta_data( Product::META, 'tee' );
	/*
	 * LA SÉRIE DU FABRICANT, pour que la boucle vérifie le gradient réel.
	 *
	 * Ce sont les vraies demi-poitrines du Gildan Heavy Cotton 18009, lues sur la
	 * fiche du fournisseur et importées dans la boutique. Elles sont ici, et pas
	 * inventées, parce que c'est la référence dont la série s'écarte le plus de
	 * la charte du studio : 1,400 entre le M et le 3XL contre 1,2295 dans
	 * `garments.json`. Le harnais peut donc distinguer, en regardant le document
	 * que le studio a écrit, s'il a gradé par la fiche ou par sa propre charte.
	 */
	$product->update_meta_data(
		'_teeshoop_demi_poitrine',
		wp_json_encode(
			array(
				'S'   => 45.72,
				'M'   => 50.8,
				'L'   => 55.88,
				'XL'  => 60.96,
				'2XL' => 66.04,
				'3XL' => 71.12,
			)
		)
	);
	/*
	 * LE DÉCOR DÉCLARE SON TEXTILE NU, et ce n'est pas de la décoration.
	 *
	 * Depuis le 5 septembre 2026 la porte argent retire toute passerelle de
	 * paiement tant qu'un produit personnalisable en vente ne dit pas quel
	 * textile l'atelier achète : la commande serait payée et jamais servie.
	 * Un décor qui ne le déclare pas fabrique donc lui-même la condition qui
	 * ferme la caisse, et le harnais échouerait au passage en caisse sans
	 * qu'aucune ligne du produit ne soit en cause.
	 *
	 * La référence est celle que le reste des harnais utilise. Elle décrit une
	 * vraie référence du catalogue importé, pas un numéro inventé.
	 */
	$product->update_meta_data( Product::META_BLANK_REF, '18001' );
	$product->update_meta_data( Product::META_BLANK_COLOURS, wp_json_encode( array( 'Noir' => 'Black' ) ) );
	$product->save();

	ts_e2e_out(
		array(
			'theme'           => $theme['theme'],
			/*
			 * RAPPORTÉ, JAMAIS AFFIRMÉ ICI, comme tout le reste de ce fichier.
			 * Quand la porte argent refuse, WooCommerce ne propose aucun moyen
			 * de paiement et le passage en caisse ne peut pas aboutir. Le
			 * harnais a besoin de lire la cause plutôt que de constater une page
			 * sans bouton.
			 */
			'porte_argent'    => array_map(
				static fn( array $b ): string => (string) ( $b['pourquoi'] ?? '' ),
				\Teeshoop\Core\Launch::money_blockers()
			),
			'theme_switched'  => (bool) ( $theme['switched'] ?? false ),
			'need_classic'    => (bool) ( $theme['need_classic'] ?? false ),
			'product_id'      => $product->get_id(),
			'url'             => get_permalink( $product->get_id() ),
			// Reported, never asserted here: the harness decides. It matters
			// because WooCommerce builds a cart for a REST request only when
			// the REST prefix is absent from REQUEST_URI, which is true of the
			// plain structure and false of production's.
			'permalinks'      => (string) get_option( 'permalink_structure' ),
			'cart_url'        => wc_get_cart_url(),
			'checkout_url'    => wc_get_checkout_url(),
			'garment'         => Product::garment_of( $product->get_id() ),
			// Ce que la page doit publier au studio : le harnais compare.
			'size_chart'      => ProductPage::maker_chart( $product->get_id() ),
			'catalogue_price' => (float) $product->get_regular_price(),
			'studio_origin'   => Settings::studio_origin(),
			'worker_url'      => Settings::get( 'worker_url' ),
			'unverified_ok'   => Settings::allow_unverified_designs(),
			/*
			 * Le chemin natif est-il branché, et son paquet est-il là.
			 *
			 * Rapporté, jamais asserté ici : le harnais décide. Sans le paquet
			 * construit, `Editeur::rendre()` retombe sur le message de secours
			 * et la fiche produit n'a pas de bouton d'achat ; le harnais doit
			 * pouvoir dire « lancez npm run build:editeur » plutôt que « le
			 * canevas n'est jamais apparu », qui est le même symptôme pour cinq
			 * causes différentes.
			 */
			'editeur_pret'    => Editeur::paquet_present(),
		)
	);
}

/**
 * Read the visitor's own cart out of the session table.
 *
 * The browser holds a `wp_woocommerce_session_*` cookie whose first field is
 * the customer id; the harness passes it in. Reading the stored session is what
 * makes this an assertion about the CUSTOMER's basket rather than about a fresh
 * one WP-CLI would otherwise create for itself.
 */
function ts_e2e_cart( string $customer_id ) {
	$handler = new WC_Session_Handler();
	$session = $handler->get_session( $customer_id );
	if ( empty( $session ) ) {
		ts_e2e_out( array( 'found' => false, 'reason' => 'no session for ' . $customer_id ) );
		return;
	}

	$cart   = maybe_unserialize( $session['cart'] ?? 'a:0:{}' );
	$totals = maybe_unserialize( $session['cart_totals'] ?? 'a:0:{}' );
	$config = Settings::pricing();
	$lines  = array();

	foreach ( (array) $cart as $key => $item ) {
		if ( empty( $item['teeshoop'] ) ) {
			continue;
		}
		$data  = $item['teeshoop'];
		$qty   = (int) $item['quantity'];
		$quote = Pricing::quote(
			array(
				'garment' => (string) ( $data['garment'] ?? '' ),
				'qty'     => $qty,
				'sides'   => (array) ( $data['sides'] ?? array() ),
			),
			$config
		);

		$lines[] = array(
			'key'          => $key,
			'product_id'   => (int) $item['product_id'],
			'qty'          => $qty,
			'garment'      => (string) ( $data['garment'] ?? '' ),
			'design_id'    => (string) ( $data['design_id'] ?? '' ),
			'sides'        => array_values( (array) ( $data['sides'] ?? array() ) ),
			'sides_source' => (string) ( $data['sides_source'] ?? '' ),
			'size_grid'    => (array) ( $data['size_grid'] ?? array() ),
			'verified'     => (bool) ( $data['verified'] ?? false ),
			'files'        => (array) ( $data['files'] ?? array() ),
			// What WooCommerce actually stored for this line, and what the price
			// authority says it should be. The harness compares them.
			'stored'       => array(
				'line_subtotal' => isset( $item['line_subtotal'] ) ? (float) $item['line_subtotal'] : null,
				'line_total'    => isset( $item['line_total'] ) ? (float) $item['line_total'] : null,
			),
			'expected'     => array(
				'unit_ht'   => $quote['unit_ht'],
				'total_ht'  => $quote['total_ht'],
				'total_ttc' => $quote['total_ttc'],
				'unit_eur'  => (float) $quote['unit_ht'] / 100,
				'total_eur' => (float) $quote['total_ht'] / 100,
				'display'   => array(
					'unit_ht'   => Money::format( $quote['unit_ht'] ),
					'total_ht'  => Money::format( $quote['total_ht'] ),
					'total_ttc' => Money::format( $quote['total_ttc'] ),
				),
			),
		);
	}

	ts_e2e_out(
		array(
			'found'        => true,
			'lines'        => $lines,
			'other_lines'  => count( (array) $cart ) - count( $lines ),
			'cart_totals'  => array(
				'subtotal' => isset( $totals['subtotal'] ) ? (float) $totals['subtotal'] : null,
				'total'    => isset( $totals['total'] ) ? (float) $totals['total'] : null,
			),
		)
	);
}

/**
 * The fail-closed path, run for real.
 *
 * `TEESHOOP_ALLOW_UNVERIFIED_DESIGNS` is NOT defined here, unlike in
 * integration.php: this container's wp-config does not set it, so `Design::verify`
 * really asks the Worker and really refuses on a 404. That is the behaviour
 * production has, and the only place it can be exercised end to end.
 */
function ts_e2e_refuse( int $product_id, string $design_id ) {
	include_once WC_ABSPATH . 'includes/wc-cart-functions.php';
	include_once WC_ABSPATH . 'includes/class-wc-cart.php';
	wc_load_cart();
	WC()->cart->empty_cart();

	$result = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => 5,
			'garment'    => 'tee',
			'sides'      => array( array( 'id' => 'front', 'area_sq_cm' => 400 ) ),
			'design_id'  => $design_id,
		)
	);

	ts_e2e_out(
		array(
			'refused'       => is_wp_error( $result ),
			'code'          => is_wp_error( $result ) ? $result->get_error_code() : '',
			'cart_count'    => WC()->cart->get_cart_contents_count(),
			'unverified_ok' => Settings::allow_unverified_designs(),
		)
	);

	WC()->cart->empty_cart();
}

/**
 * What an order carries, once a real checkout has produced it.
 *
 * Reported and never judged, like everything else here: the harness decides.
 * `$confirm` moves it to `processing`, which is the shop saying the transfer
 * arrived, and is the transition a listener on `woocommerce_payment_complete`
 * alone would never see because BACS does not call it.
 */
function ts_e2e_order( int $order_id, bool $confirm ) {
	$order = $order_id > 0 ? wc_get_order( $order_id ) : null;
	if ( ! $order instanceof \WC_Order ) {
		ts_e2e_out( array( 'found' => false ) );
		return;
	}

	if ( $confirm ) {
		$order->update_status( 'processing', 'Virement reçu (vérification).' );
		$order = wc_get_order( $order_id );
	}

	$lines = array();
	foreach ( $order->get_items() as $item ) {
		$lines[] = array(
			'name'      => $item->get_name(),
			'qty'       => (int) $item->get_quantity(),
			'total'     => (float) $item->get_total(),
			'design_id' => (string) $item->get_meta( '_teeshoop_design_id', true ),
			'garment'   => (string) $item->get_meta( '_teeshoop_garment', true ),
			'size_grid' => (string) $item->get_meta( '_teeshoop_size_grid', true ),
		);
	}

	$shipping = array();
	foreach ( $order->get_items( 'shipping' ) as $item ) {
		$shipping[] = array(
			'method'    => (string) $item->get_method_id(),
			'total'     => (float) $item->get_total(),
			'borne_ht'  => (int) $item->get_meta( '_teeshoop_borne_ht', true ),
			'parcel_g'  => (int) $item->get_meta( '_teeshoop_parcel_g', true ),
			'free'      => (string) $item->get_meta( '_teeshoop_free', true ),
		);
	}

	$doc = \Teeshoop\Core\Invoice::stored( $order );
	$pdf = null === $doc ? '' : \Teeshoop\Core\Invoice::pdf( $doc );

	ts_e2e_out(
		array(
			'found'          => true,
			'id'             => $order->get_id(),
			'status'         => $order->get_status(),
			// So the harness can try the invoice route the way a customer would.
			'key'            => $order->get_order_key(),
			'payment_method' => $order->get_payment_method(),
			'lines'          => $lines,
			'shipping'       => $shipping,
			'totals'         => array(
				'subtotal' => (float) $order->get_subtotal(),
				'shipping' => (float) $order->get_shipping_total(),
				'tax'      => (float) $order->get_total_tax(),
				'total'    => (float) $order->get_total(),
			),
			'frozen'         => array(
				'regime'  => (string) $order->get_meta( \Teeshoop\Core\Checkout::META_VAT_REGIME, true ),
				'rate'    => (string) $order->get_meta( \Teeshoop\Core\Checkout::META_VAT_RATE, true ),
				'basis'   => (string) $order->get_meta( \Teeshoop\Core\Checkout::META_BASIS, true ),
				'version' => (string) $order->get_meta( \Teeshoop\Core\Checkout::META_VERSION, true ),
				'config'  => '' !== (string) $order->get_meta( \Teeshoop\Core\Checkout::META_CONFIG, true ),
			),
			/*
			 * THE ONE RECORD THE HARNESS TICKED AND NEVER LOOKED AT.
			 *
			 * `wp-e2e-verify.mjs` has ticked « J'accepte de perdre le droit de
			 * rétractation » on every run since session 06 and asserted nothing
			 * about it, and this payload had no field it could have asserted on.
			 * The block checkout is the one the mirror uses, so `freeze_block`
			 * was the only unexercised half of the shop's only defence against a
			 * fourteen-day withdrawal on a printed garment.
			 */
			'renonciation'   => ( static function () use ( $order ): array {
				$record = \Teeshoop\Core\Waiver::record( $order );
				return array(
					'applies' => \Teeshoop\Core\Waiver::applies( $order ),
					'at'      => null === $record ? '' : (string) ( $record['at'] ?? '' ),
					'ip'      => null === $record ? '' : (string) ( $record['ip'] ?? '' ),
					'cgv'     => null === $record ? '' : (string) ( $record['cgv'] ?? '' ),
					'text'    => null === $record ? '' : (string) ( $record['text'] ?? '' ),
					'expected_text' => \Teeshoop\Core\Waiver::text(),
					'expected_cgv'  => \Teeshoop\Core\Legal::cgv_version(),
					'created'       => $order->get_date_created() ? $order->get_date_created()->date( 'c' ) : '',
				);
			} )(),
			'invoice'        => array(
				'number'   => null === $doc ? '' : (string) $doc['number'],
				'total'    => null === $doc ? 0 : (int) $doc['total_ttc'],
				'mention'  => null === $doc ? '' : (string) $doc['mention'],
				'stamp'    => null === $doc ? '' : (string) $doc['stamp'],
				'pdf_size' => strlen( $pdf ),
				'url'      => null === $doc ? '' : \Teeshoop\Core\Invoice::url( $order ),
			),
		)
	);
}

$mode = isset( $args[0] ) ? (string) $args[0] : '';

if ( 'setup' === $mode ) {
	ts_e2e_setup( (string) ( $args[1] ?? '' ), (string) ( $args[2] ?? '' ) );
} elseif ( 'cart' === $mode ) {
	ts_e2e_cart( (string) ( $args[1] ?? '' ) );
} elseif ( 'refuse' === $mode ) {
	ts_e2e_refuse( (int) ( $args[1] ?? 0 ), (string) ( $args[2] ?? '' ) );
} elseif ( 'order' === $mode ) {
	ts_e2e_order( (int) ( $args[1] ?? 0 ), 'confirmer' === (string) ( $args[2] ?? '' ) );
} else {
	ts_e2e_out( array( 'error' => 'unknown mode ' . $mode ) );
	exit( 2 );
}
