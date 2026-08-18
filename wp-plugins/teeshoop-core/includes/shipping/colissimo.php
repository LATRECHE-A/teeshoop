<?php
/**
 * The WooCommerce shipping method, kept out of `includes/` on purpose.
 *
 * It extends `WC_Shipping_Method`, which does not exist until WooCommerce has
 * loaded. `scripts/hypotheses-guard.mjs` requires every file in `includes/` in a
 * bare PHP process with no WordPress at all, so a class extending a missing
 * parent there is a fatal at parse time and the whole register check would go
 * from "the values agree" to "php could not read the plugin". One directory
 * deeper is enough: the guard's glob is not recursive.
 *
 * The arithmetic is all in Shipping.php, which is pure and tested. This file is
 * the adapter and holds no rule of its own.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Shipping_Colissimo extends \WC_Shipping_Method {

	public function __construct( $instance_id = 0 ) {
		$this->id                 = Shipping::METHOD_ID;
		$this->instance_id        = absint( $instance_id );
		$this->method_title       = __( 'Colissimo (grille publique)', 'teeshoop' );
		$this->method_description = __( 'Tarif au poids selon la grille publique de La Poste, plus l’emballage. La livraison est offerte au-dessus du seuil réglé dans Teeshoop.', 'teeshoop' );
		$this->supports           = array( 'shipping-zones', 'instance-settings' );
		$this->enabled            = 'yes';
		$this->title              = __( 'Colissimo', 'teeshoop' );

		$this->init_instance_settings();
	}

	/**
	 * @param array $package WooCommerce shipping package.
	 */
	public function calculate_shipping( $package = array() ) {
		// Cleared first. The recorded reason describes THIS package, and a
		// sticky one made a later, perfectly shippable basket report the
		// refusal of an earlier one.
		Shipping::remember_refusal( '' );

		$config = Shipping::config();

		$destination = (array) ( $package['destination'] ?? array() );
		if ( ! Shipping::serves( (string) ( $destination['country'] ?? '' ), (string) ( $destination['postcode'] ?? '' ), $config ) ) {
			Shipping::remember_refusal( Shipping::OFF_ZONE );
			return;
		}

		$weighed = Shipping::weigh( $package );
		$quote   = Shipping::quote(
			$weighed['grams'],
			$weighed['pieces'],
			$weighed['goods_ht'],
			$config,
			$weighed['weighable']
		);

		if ( ! $quote['ok'] ) {
			Shipping::remember_refusal( $quote['reason'] );
			return;
		}

		$this->add_rate(
			array(
				'id'        => $this->get_rate_id(),
				'label'     => $quote['free']
					? __( 'Colissimo, livraison offerte', 'teeshoop' )
					: __( 'Colissimo, France métropolitaine', 'teeshoop' ),
				'cost'      => (string) Money::to_eur( $quote['charged_ht'] ),
				/*
				 * '' means "work the tax out for me", which is what we want:
				 * carriage billed alongside a sale of goods follows the goods'
				 * own rate, so it is taxable at 20 % under the standard regime
				 * even though the stamp we buy carries no VAT at all. Under
				 * franchise the shop has no rate table and this adds nothing.
				 */
				'taxes'     => '',
				'calc_tax'  => 'per_order',
				/*
				 * Frozen onto the order through WooCommerce's own shipping-line
				 * meta: what the carrier costs, what the packing costs, and what
				 * we bear whether or not the customer paid for it. Session 05
				 * subtracts `borne_ht` from the margin, and a free delivery whose
				 * cost was never recorded is a margin nobody can reconstruct.
				 */
				'meta_data' => array(
					'_teeshoop_carrier_ht'   => (string) $quote['carrier_ht'],
					'_teeshoop_packaging_ht' => (string) $quote['packaging_ht'],
					'_teeshoop_borne_ht'     => (string) $quote['borne_ht'],
					'_teeshoop_parcel_g'     => (string) $quote['parcel_g'],
					'_teeshoop_free'         => $quote['free'] ? 'yes' : 'no',
				),
			)
		);
	}
}
