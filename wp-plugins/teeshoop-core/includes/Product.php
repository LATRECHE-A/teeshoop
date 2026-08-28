<?php
/**
 * Which studio garment a WooCommerce product is.
 *
 * The studio knows `tee`, `hoodie` and `custom`. WooCommerce knows product
 * 412. Something has to join the two, and where that mapping lives decides how
 * it fails.
 *
 * IT LIVES ON THE PRODUCT, as post meta `_teeshoop_garment`. Three reasons, and
 * the third is why it is not negotiable:
 *
 *   It is a property OF the product, in the same sense as its weight. A shop
 *   manager who duplicates a t-shirt gets the mapping duplicated with it; one
 *   who exports the catalogue exports it; one who restores a backup restores
 *   it. An option holding a map of product id to garment survives none of that,
 *   and drifts silently the first time a product is added by someone who never
 *   heard of the map.
 *
 *   WordPress can query it. `meta_query` on `_teeshoop_garment` answers "which
 *   products are personalisable", which the catalogue, the sitemap and the
 *   production screen all end up wanting. A serialised option cannot be
 *   queried at all.
 *
 *   IT IS A PRICE INPUT, and therefore it must not arrive from a browser. The
 *   garment decides the blank cost: `tee` is 9,50 EUR of base and `custom` is
 *   zero, because with `custom` the customer ships their own shirt. Before this
 *   file existed `Cart::add` took the garment from the add-to-cart body and
 *   checked only that it was a garment the config knew, so a request naming
 *   `custom` on a hoodie product bought a 27,00 EUR blank for nothing. The
 *   product is the authority; the request is a claim, and a claim that
 *   disagrees is refused rather than quietly corrected, because a disagreement
 *   means the page and the studio are selling two different things.
 *
 * A product with no declared garment is not personalisable. That is a decision,
 * not an oversight: the alternative is to fall back to the request, which is
 * the hole above with a longer fuse.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Product {

	/**
	 * Underscore-prefixed: this is machinery, not a customer-visible attribute,
	 * so it stays out of the product's public custom-field list.
	 */
	public const META = '_teeshoop_garment';

	/**
	 * WHICH BLANK THIS PRODUCT IS PRINTED ON, as an imported catalogue reference.
	 *
	 * ── WHY THIS EXISTS, AND WHY IT IS A REFERENCE AND NOT A PRICE ───────────
	 *
	 * The garment above says what the studio draws on. It does not say what the
	 * workshop BUYS. Until this field, nothing did: the three studio garments are
	 * attached to no catalogue article at all, so an order for thirty t-shirts
	 * produced a purchase basket in which every line read « aucune référence »,
	 * and the cost engine fell back to a purchase price typed by hand on the
	 * costs screen, with no size, no colour and no stock behind it.
	 *
	 * IT IS THE REFERENCE AN OPERATOR ALREADY KNOWS, not a WordPress id. The
	 * importer writes the same reference on the parent product as
	 * `Catalogue::META_REF`, so this resolves by lookup; asking for a post id
	 * would mean hunting through 459 products for a number that means nothing
	 * to anybody.
	 *
	 * NOTHING IS DERIVED FROM IT. The article the workshop orders is looked up
	 * among the variations the importer wrote, by colour term and by size name.
	 * The supplier's article number is `styleNr . colourCode . one digit` and
	 * the size-to-digit map is the same across every colour, so a reference plus
	 * a size could be turned into an article number by string arithmetic. That
	 * would be a guessed procurement key, and `Catalogue::variations()` already
	 * records what it costs to publish one.
	 */
	public const META_BLANK_REF = '_teeshoop_blank_ref';

	/**
	 * Studio colour id to the maker's own colour name, JSON, on this product.
	 *
	 * « Blanc » is not a colour a supplier sells; « White », « Off White » and
	 * « Optical White » are, and chapter 04 of the brief says in as many words
	 * that « Navy », « French Navy » and « Deep Navy » must not be merged
	 * without a rule. There is no rule that can be written down here, so the
	 * mapping is chosen once per product by whoever knows the blank, from the
	 * colour terms that product actually has.
	 *
	 * A colour with no entry is UNRESOLVED, never approximated. Ordering the
	 * wrong colour costs the whole run: the film is already printed when the
	 * blanks arrive.
	 */
	public const META_BLANK_COLOURS = '_teeshoop_blank_colours';

	public static function init(): void {
		add_action( 'woocommerce_product_options_general_product_data', array( self::class, 'field' ) );
		add_action( 'woocommerce_admin_process_product_object', array( self::class, 'save' ) );
	}

	/**
	 * The studio garment this product is, or '' when it is not personalisable.
	 *
	 * Never guesses. An unknown or removed garment key reads as '' rather than
	 * as the first one in the config, because pricing a hoodie as a t-shirt is
	 * worse than refusing the line.
	 */
	public static function garment_of( int $product_id ): string {
		if ( $product_id <= 0 ) {
			return '';
		}
		$raw = get_post_meta( $product_id, self::META, true );
		if ( ! is_string( $raw ) || '' === $raw ) {
			return '';
		}
		$key    = sanitize_key( $raw );
		$config = Settings::pricing();
		return isset( $config['garments'][ $key ] ) ? $key : '';
	}

	/** The choices a shop manager sees, built from the price config itself. */
	private static function choices(): array {
		$out = array( '' => __( 'Non personnalisable', 'teeshoop' ) );
		foreach ( array_keys( Settings::pricing()['garments'] ) as $key ) {
			$out[ $key ] = $key;
		}
		return $out;
	}

	/** The catalogue reference this product's blanks are bought as, or ''. */
	public static function blank_ref_of( int $product_id ): string {
		if ( $product_id <= 0 ) {
			return '';
		}
		$raw = get_post_meta( $product_id, self::META_BLANK_REF, true );
		return is_string( $raw ) ? trim( $raw ) : '';
	}

	/**
	 * Studio colour id to the maker's colour name, for this product.
	 *
	 * @return array<string,string>
	 */
	public static function blank_colours_of( int $product_id ): array {
		if ( $product_id <= 0 ) {
			return array();
		}
		$raw = json_decode( (string) get_post_meta( $product_id, self::META_BLANK_COLOURS, true ), true );
		if ( ! is_array( $raw ) ) {
			return array();
		}
		$out = array();
		foreach ( $raw as $studio => $term ) {
			$studio = sanitize_key( (string) $studio );
			$term   = trim( (string) $term );
			if ( '' !== $studio && '' !== $term ) {
				$out[ $studio ] = $term;
			}
		}
		return $out;
	}

	/** The fields on the product edit screen, under General. */
	public static function field(): void {
		woocommerce_wp_select(
			array(
				'id'          => self::META,
				'label'       => __( 'Vêtement Teeshoop', 'teeshoop' ),
				'description' => __( 'Le vêtement du studio que cet article représente. Il décide du prix du textile nu, il est donc lu ici et jamais dans la requête qui ajoute la ligne.', 'teeshoop' ),
				'desc_tip'    => true,
				'options'     => self::choices(),
			)
		);

		global $post;
		$product_id = $post instanceof \WP_Post ? (int) $post->ID : 0;
		$ref        = self::blank_ref_of( $product_id );

		woocommerce_wp_text_input(
			array(
				'id'          => self::META_BLANK_REF,
				'value'       => $ref,
				'label'       => __( 'Textile nu acheté (référence du catalogue)', 'teeshoop' ),
				'description' => __( 'La référence du catalogue fournisseur sur laquelle ce produit est imprimé, par exemple 18001. Elle décide ce que l’atelier achète : sans elle, aucun panier d’achat ne peut être constitué pour ce produit.', 'teeshoop' ),
				'desc_tip'    => true,
			)
		);

		self::colour_fields( $product_id, $ref );
	}

	/**
	 * One select per studio colour, listing the blank's REAL colours.
	 *
	 * ── WHY SELECTS AND NOT A TEXT FIELD ─────────────────────────────────────
	 *
	 * Because a typo here orders the wrong colour, the film is already printed
	 * when the boxes arrive, and the run is scrap. The options are the colour
	 * terms that reference actually has in this shop, so a colour that cannot be
	 * bought cannot be chosen.
	 *
	 * ── AND WHY THE EMPTY STATE IS A SENTENCE, NOT AN EMPTY BOX ──────────────
	 *
	 * The options can only be listed once the reference is saved and imported.
	 * Both of those can be false for perfectly ordinary reasons, and each says
	 * which one it is: « enregistrez d'abord la référence » and « cette
	 * référence n'est pas dans le catalogue importé » are different problems
	 * with different fixes.
	 */
	private static function colour_fields( int $product_id, string $ref ): void {
		echo '<div class="options_group">';
		echo '<p class="form-field"><label>' . esc_html__( 'Correspondance des coloris', 'teeshoop' ) . '</label>';

		if ( '' === $ref ) {
			echo '<span class="description">' . esc_html__( 'Renseignez la référence du textile nu ci-dessus et enregistrez : les coloris du fournisseur apparaîtront ici.', 'teeshoop' ) . '</span></p></div>';
			return;
		}

		$blank_id = Purchase::blank_product_id( $ref );
		if ( 0 === $blank_id ) {
			echo '<span class="description">' . esc_html(
				sprintf(
					/* translators: %s: a catalogue reference typed by a shop manager. */
					__( 'La référence %s n’est pas dans le catalogue importé. Importez-la, puis revenez ici.', 'teeshoop' ),
					$ref
				)
			) . '</span></p></div>';
			return;
		}

		$terms = Purchase::blank_colour_terms( $blank_id );
		if ( array() === $terms ) {
			echo '<span class="description">' . esc_html__( 'Cette référence n’a aucun coloris enregistré dans la boutique.', 'teeshoop' ) . '</span></p></div>';
			return;
		}

		echo '<span class="description">' . esc_html__( 'Le coloris que le client choisit dans le studio n’est pas celui que le fournisseur vend. Un coloris laissé vide bloque l’achat de cette commande plutôt que d’être remplacé par un autre.', 'teeshoop' ) . '</span></p>';

		$map = self::blank_colours_of( $product_id );
		echo '<table class="widefat striped" style="margin:0 12px 12px"><tbody>';
		foreach ( (array) ( Garments::all()['colors'] ?? array() ) as $colour ) {
			if ( ! is_array( $colour ) ) {
				continue;
			}
			$id   = sanitize_key( (string) ( $colour['id'] ?? '' ) );
			$name = (string) ( $colour['name'] ?? $id );
			if ( '' === $id ) {
				continue;
			}
			$field = self::META_BLANK_COLOURS . '[' . $id . ']';
			echo '<tr><th scope="row" style="width:14em"><label for="' . esc_attr( $field ) . '">' . esc_html( $name ) . '</label></th><td>';
			echo '<select name="' . esc_attr( $field ) . '" id="' . esc_attr( $field ) . '">';
			echo '<option value="">' . esc_html__( 'Non acheté', 'teeshoop' ) . '</option>';
			foreach ( $terms as $term ) {
				echo '<option value="' . esc_attr( $term ) . '"' . selected( $map[ $id ] ?? '', $term, false ) . '>' . esc_html( $term ) . '</option>';
			}
			echo '</select></td></tr>';
		}
		echo '</tbody></table></div>';
	}

	/**
	 * Save it through the product object.
	 *
	 * `$product->update_meta_data()` rather than `update_post_meta()`: the CRUD
	 * is what keeps this working under High-Performance Order Storage and what
	 * the plugin already declares compatibility with.
	 */
	public static function save( \WC_Product $product ): void {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- Woo verified the product-edit nonce before this hook.
		$raw = isset( $_POST[ self::META ] ) ? sanitize_key( wp_unslash( (string) $_POST[ self::META ] ) ) : '';
		$config = Settings::pricing();
		$product->update_meta_data( self::META, isset( $config['garments'][ $raw ] ) ? $raw : '' );

		/*
		 * The reference is stored as typed, minus whitespace, and NOT validated
		 * against the catalogue here. A shop manager who declares a reference
		 * before importing it has done something reasonable in the wrong order,
		 * and silently blanking their entry would look like the field not
		 * working. It is the purchase basket that refuses, by name, at the point
		 * where being wrong costs money.
		 */
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- as above.
		$ref = isset( $_POST[ self::META_BLANK_REF ] ) ? trim( sanitize_text_field( wp_unslash( (string) $_POST[ self::META_BLANK_REF ] ) ) ) : '';
		$product->update_meta_data( self::META_BLANK_REF, preg_match( '/^[A-Za-z0-9._-]{0,32}$/', $ref ) ? $ref : '' );

		/*
		 * A COLOUR MAP IS ONLY WRITTEN WHEN THE FORM CARRIED ONE.
		 *
		 * `woocommerce_admin_process_product_object` also fires for quick edit
		 * and for the REST product endpoint, neither of which renders these
		 * fields. Writing an empty map from a form that never had them would
		 * erase the mapping of every personalisable product the first time
		 * somebody bulk-edited a price.
		 */
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- as above.
		if ( ! isset( $_POST[ self::META_BLANK_COLOURS ] ) || ! is_array( $_POST[ self::META_BLANK_COLOURS ] ) ) {
			return;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- as above.
		$posted = wp_unslash( $_POST[ self::META_BLANK_COLOURS ] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitised field by field below.
		$known  = array();
		foreach ( (array) ( Garments::all()['colors'] ?? array() ) as $colour ) {
			if ( is_array( $colour ) && '' !== (string) ( $colour['id'] ?? '' ) ) {
				$known[ sanitize_key( (string) $colour['id'] ) ] = true;
			}
		}
		$map = array();
		foreach ( (array) $posted as $studio => $term ) {
			$studio = sanitize_key( (string) $studio );
			$term   = trim( sanitize_text_field( (string) $term ) );
			if ( isset( $known[ $studio ] ) && '' !== $term ) {
				$map[ $studio ] = $term;
			}
		}
		$product->update_meta_data( self::META_BLANK_COLOURS, array() === $map ? '' : (string) wp_json_encode( $map ) );
	}
}
