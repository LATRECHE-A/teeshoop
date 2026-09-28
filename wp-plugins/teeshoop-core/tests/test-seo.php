<?php
/**
 * The JSON-LD island WooCommerce prints for a priced product, cleaned.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

/*
 * COMMAND LINE ONLY. `wp-content/plugins/` is served by URL and this directory
 * is inside it.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Seo.php';

use Teeshoop\Core\Seo;

describe( 'Seo: WooCommerce product JSON-LD', function () {
	it( 'gives the brand its ampersand back, from a title stored with an entity', function () {
		// What WooCommerce 11.0.1 prints for a title stored as « B&amp;C … »:
		// json_encode, then wc_esc_json( …, true ) escapes the & once more.
		$woo  = '<script type="application/ld+json">{"@type":"Product","name":"B&amp;amp;C #E150 T-Shirt","offers":[{"price":"22.10"}]}</script>';
		$out  = Seo::clean_ld_json( $woo );
		$data = json_decode( substr( $out, strlen( '<script type="application/ld+json">' ), -strlen( '</script>' ) ), true );
		eq( $data['name'] ?? null, 'B&C #E150 T-Shirt', 'the name a crawler reads' );
		eq( $data['offers'][0]['price'] ?? null, '22.10', 'the rest of the data is untouched' );
	} );

	it( 'cannot be made to close its own script element', function () {
		$woo = '<script type="application/ld+json">{"name":"x&lt;/script&gt;&lt;script&gt;alert(1)"}</script>';
		$out = Seo::clean_ld_json( $woo );
		truthy( ! str_contains( substr( $out, 10 ), "</script><script>" ), "a value closed the element" );
		// chr( 92 ) is the backslash: JSON_HEX_TAG writes < and > as backslash-u003C and backslash-u003E.
		truthy( str_contains( $out, 'x' . chr( 92 ) . 'u003C/script' . chr( 92 ) . 'u003E' ), 'the angle brackets are not JSON-escaped' );
	} );

	it( 'leaves alone anything that is not exactly one JSON-LD block', function () {
		eq( Seo::clean_ld_json( '' ), '', 'empty' );
		eq( Seo::clean_ld_json( '<script type="application/ld+json">not json</script>' ), '<script type="application/ld+json">not json</script>', 'unparseable' );
	} );
} );
