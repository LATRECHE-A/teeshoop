<?php
/**
 * La gamme personnalisable : les références qu'on imprime, et rien d'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEUX PRODUITS, UNE RÉFÉRENCE, ET C'EST VOULU
 *
 * L'import écrit 2 300 produits variables qui portent le vocabulaire du
 * fournisseur, ses coloris, ses tailles et son prix d'achat. Aucun ne porte de
 * prix de vente, parce que la question 42 est tranchée par l'associé le
 * 1er septembre 2026 : « Non applicable au moteur e-commerce principal pour le
 * lancement. Aucune mise en vente massive de textile nu n'est nécessaire. »
 * Le catalogue se CONSULTE.
 *
 * Ce que le client ACHÈTE est un autre produit : une offre de marquage, simple,
 * au tarif du studio, qui déclare sur quel textile nu elle est imprimée. C'est
 * exactement ce que `Product::META_BLANK_REF` a été écrit pour porter, et c'est
 * ce que fait mistertee : une page « t-shirt personnalisé » devant un catalogue
 * de blancs qu'on ne vend pas nus.
 *
 * Un seul produit ne peut pas faire les deux. `WC_Product_Variable::is_purchasable()`
 * exige un prix sur les déclinaisons, en écrire un serait répondre à la
 * question 42 à la place de celui qui l'a déjà tranchée, et le prix d'une ligne
 * personnalisée n'est de toute façon pas un prix de déclinaison : il dépend de
 * la quantité et de la surface imprimée, et c'est `Pricing::quote()` qui le
 * calcule au moment de l'ajout au panier.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI EST CHOISI ICI, ET C'EST LA SEULE CHOSE
 *
 * `RANGE` : quelles références on imprime, et sous quel vêtement du studio.
 * Tout le reste de ce fichier est DÉRIVÉ de ce que la boutique sait déjà : le
 * nom, la photographie, la marque, la matière, le grammage et les coloris
 * viennent du produit importé ; le prix vient de `Pricing`.
 *
 * Le vêtement du studio n'est pas décoratif : c'est lui qui décide ce que
 * l'éditeur DESSINE. Le studio ne connaît que `tee` et `hoodie`, donc la gamme
 * ne contient que des t-shirts et des sweats à capuche. Un polo rangé sous
 * `tee` montrerait au client un col rond sur un vêtement qui a un col boutonné,
 * ce qui est un visuel fabriqué et pas une approximation. Les familles que le
 * studio ne sait pas dessiner sont nommées dans le rapport de la nuit 2 et dans
 * `docs/decisions/2026-09-04-gamme-de-lancement.md`, pas rétrécies en silence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LES COULEURS SONT MESURÉES, JAMAIS INVENTÉES
 *
 * `src/content/palettes.ts` porte dix-huit noms de teinture inventés pour une
 * démonstration (« Mint », « Kelly », « Sand »). Ils décident de ce que
 * l'éditeur PEINT et ne disent rien de ce que l'atelier peut ACHETER. Proposer
 * « Mint » sur une référence qui n'a pas de vert d'eau, c'est vendre une couleur
 * qui n'existe pas, et le client s'en aperçoit quand il reçoit autre chose.
 *
 * Alors la correspondance est dérivée, pas saisie : chaque couleur du studio est
 * convertie en OKLab, classée par `Swatch::family()` (les frontières refaites en
 * séance 09 sur 300 noms étiquetés), et rapprochée du coloris MESURÉ le plus
 * proche parmi ceux que cette référence possède DANS LA MÊME FAMILLE. Une
 * couleur du studio sans aucun coloris de sa famille sur cette référence n'est
 * pas proposée du tout. Pas de seuil numérique inventé : la famille est la
 * porte, et elle a déjà été validée contre des étiquettes humaines.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Gamme {

	/**
	 * Product meta: this offer was created by this module, from that reference.
	 *
	 * Its VALUE is the reference, so a second run finds its own product by
	 * meta rather than by title. A title is customer copy and changes; the
	 * reference is the supplier's key and does not.
	 */
	public const META_SOURCE = '_teeshoop_gamme';

	/**
	 * La gamme de lancement : référence fournisseur => vêtement du studio.
	 *
	 * Choisies le 4 septembre 2026 parmi les 185 t-shirts et 195 sweats que
	 * l'import a écrits, sur quatre critères mesurables et un seul jugement.
	 * Mesurables : une photographie de face ET une de dos (sinon le dos du
	 * client est une reconstruction), une fiche de mesures du fabricant (sinon
	 * l'échelle de la zone d'impression n'est pas dérivable), du stock chez le
	 * fournisseur, et un nombre de coloris qui vaut la peine d'être proposé.
	 * Le jugement : six marques différentes plutôt que six variantes d'une, pour
	 * que la gamme couvre une fourchette de prix d'achat et pas un point.
	 *
	 * LA FOURCHETTE DE PRIX D'ACHAT EST UN CRITÈRE, pas un hasard. Le tarif
	 * publié est un tarif PAR VÊTEMENT DU STUDIO, un seul pour tous les
	 * t-shirts de la gamme. Il doit donc tenir au-dessus du plancher pour le
	 * textile nu le PLUS CHER de sa famille, sinon la référence chère se vend à
	 * perte pendant que les autres vont bien. C'est pour ça que le Russell
	 * Athletic Authentic Hooded (28,13 EUR le nu contre 14,55 pour le Fruit of
	 * the Loom) n'est pas dans la gamme : un tarif qui le couvre surfacture les
	 * trois autres de moitié. `tests/integration-grille.php` refuse la
	 * configuration qui l'oublierait.
	 */
	public const RANGE = array(
		// T-shirts. De 3,00 EUR le nu (B&C #E150) à 6,14 EUR (B&C #E190).
		'01542' => 'tee',
		'01942' => 'tee',
		'15001' => 'tee',
		'15009' => 'tee',
		'18009' => 'tee',
		'00142' => 'tee',
		// Sweats à capuche. De 14,55 EUR le nu (Fruit of the Loom) à 21,07
		// (Gildan Heavy Blend).
		'27601' => 'hoodie',
		'23742' => 'hoodie',
		'29009' => 'hoodie',
	);

	/**
	 * Les produits qui ne sont plus à vendre, et pourquoi ils existent.
	 *
	 * Le 4 septembre 2026 la boutique comptait neuf produits achetables et huit
	 * étaient des montages de harnais. Ils ne sont pas SUPPRIMÉS : cinq d'entre
	 * eux sont créés par leur propre harnais (`tests/e2e-support.php`,
	 * `tests/bat-support.php`, `tests/demo-achat.php`, `tests/invoice-probe.php`)
	 * et les supprimer casserait la prochaine exécution sans rien apprendre à
	 * personne. Ils sortent de la VENTE : plus de prix, donc
	 * `WC_Product::is_purchasable()` répond non, donc ils disparaissent du
	 * portail de mise en ligne et d'une boutique en ligne.
	 *
	 * Reconnus par leur slug ou, à défaut, par leur titre exact. Le slug est ce
	 * qui survit à une traduction ; le titre est ce qui reste des montages
	 * qu'aucun fichier du dépôt ne crée (les trois « Probe fixture » et
	 * « Repro tee », résidus d'une sonde d'une séance passée).
	 */
	public const FIXTURES = array(
		'Probe fixture',
		'Probe fixture 2',
		'Probe fixture 3',
		'Repro tee',
		'Tee de vérification',
		'Tee-shirt du harnais BAT',
		'T-shirt personnalisé (démonstration achat)',
		'T-shirt personnalisable',
		'T-shirt personnalisé, coton bio',
	);

	/**
	 * The colour a studio dye id stands for, as the studio paints it.
	 *
	 * Read from `data/garments.json`, which `scripts/gen-garment-data.mjs`
	 * writes from `src/content/palettes.ts` and `npm run verify:garments`
	 * refuses to let go stale. Not retyped here: the hexes decide which family
	 * a studio colour lands in, and a second copy of them would decide it
	 * differently the day one moves.
	 *
	 * @return array<string,array{name:string,hex:string}>
	 */
	public static function studio_colours(): array {
		$out = array();
		foreach ( (array) ( Garments::all()['colors'] ?? array() ) as $colour ) {
			if ( ! is_array( $colour ) ) {
				continue;
			}
			$id  = sanitize_key( (string) ( $colour['id'] ?? '' ) );
			$hex = strtoupper( trim( (string) ( $colour['hex'] ?? '' ) ) );
			if ( '' === $id || 1 !== preg_match( '/^#[0-9A-F]{6}$/', $hex ) ) {
				continue;
			}
			$out[ $id ] = array(
				'name' => (string) ( $colour['name'] ?? $id ),
				'hex'  => $hex,
			);
		}
		return $out;
	}

	/**
	 * OKLab of a `#RRGGBB`, through the one conversion the shop owns.
	 *
	 * @return array{0:float,1:float,2:float}
	 */
	private static function lab_of_hex( string $hex ): array {
		return Swatch::oklab(
			(int) hexdec( substr( $hex, 1, 2 ) ),
			(int) hexdec( substr( $hex, 3, 2 ) ),
			(int) hexdec( substr( $hex, 5, 2 ) )
		);
	}

	/**
	 * Le nuancier d'une référence : ce que le client voit et ce que l'atelier achète.
	 *
	 * ── CE QUE LE CLIENT VOIT EST LA PASTILLE MESURÉE, PAS L'APPROXIMATION ──────
	 *
	 * Chaque entrée porte trois choses : l'identifiant de teinture du studio
	 * (`Design.colorId`, ce que l'éditeur peint), le NOM DU FABRICANT et les
	 * ARRÊTS DE COULEUR MESURÉS sur sa propre pastille. Le client lit « Fuchsia »
	 * sous un rond fuchsia, et pas « Rose » sous un rond rose pâle qui deviendra
	 * du fuchsia à la livraison.
	 *
	 * Mesuré le 4 septembre 2026 sur les neuf références de la gamme : le studio
	 * peint son « Rose » en #F3A6C0 et le plus proche coloris rose du B&C #E150
	 * est « Fuchsia », à 0,306 en OKLab. Son « Menthe » (#BFE3D0) tombe sur
	 * « Kelly Green » à 0,294 sur le Fruit of the Loom. Les deux passeraient
	 * n'importe quelle porte par famille et les deux mentent au client si c'est
	 * le rond du studio qu'on lui montre.
	 *
	 * ── POURQUOI PAS UN PLAFOND DE DISTANCE ────────────────────────────────────
	 *
	 * Parce que les dix-huit teintes du studio ne sont pas des mesures. Mesuré :
	 * le « Noir » du studio est #191C20 et le Black du fournisseur est à 0,225
	 * de là, SUR LES NEUF RÉFÉRENCES. Un plafond à 0,12 (la tolérance
	 * `Colours::PHOTO_MAX` que la boutique applique déjà entre une pastille et
	 * sa photo) refuserait le noir partout, c'est-à-dire la couleur la plus
	 * vendue du métier. Le hex du studio est une teinte de RENDU, pas une
	 * revendication colorimétrique, et un plafond colorimétrique contre lui est
	 * le mauvais instrument. C'est la présentation qu'on corrige, pas la porte.
	 *
	 * ── UNE PASTILLE FOURNISSEUR NE SERT QU'UNE FOIS ───────────────────────────
	 *
	 * Sans cette règle, « Vert forêt » et « Vert gazon » tombaient tous les deux
	 * sur « Bottle Green » du B&C ID.333, et « Sable » et « Marron » tous les
	 * deux sur « Mastic » : deux choix distincts à l'écran, un seul vêtement à
	 * l'arrivée. Le plus proche garde la pastille, l'autre n'est pas proposé.
	 *
	 * @return array{deck:array<string,array{term:string,name:string,stops:string[],delta:float}>,refused:array<string,string>,unmeasured:string[]}
	 */
	public static function palette( int $blank_id ): array {
		$terms      = get_the_terms( $blank_id, Colours::TAXONOMY );
		$deck       = array();
		$refused    = array();
		$unmeasured = array();

		if ( ! is_array( $terms ) || array() === $terms ) {
			foreach ( self::studio_colours() as $id => $colour ) {
				$refused[ $id ] = __( 'la référence n’a aucun coloris enregistré', 'teeshoop' );
			}
			return array(
				'deck'       => $deck,
				'refused'    => $refused,
				'unmeasured' => $unmeasured,
			);
		}

		Colours::prime( wp_list_pluck( $terms, 'term_id' ) );

		/*
		 * The candidates, once, with their PUBLISHED family and their measured
		 * stops. `Colours::read()` returns null for a term nobody has measured,
		 * and that term is listed rather than guessed at: an unmeasured colour
		 * has no family, so it cannot be matched and must not be proposed.
		 */
		$candidates = array();
		foreach ( $terms as $term ) {
			$read = Colours::read( (int) $term->term_id );
			if ( null === $read || array() === $read['labs'] || '' === (string) $read['family'] ) {
				$unmeasured[] = (string) $term->name;
				continue;
			}
			$candidates[] = array(
				'name'   => (string) $term->name,
				'slug'   => (string) $term->slug,
				'family' => (string) $read['family'],
				'labs'   => $read['labs'],
				'stops'  => array_values( array_filter( (array) $read['stops'], static fn( $h ): bool => 1 === preg_match( '/^#[0-9a-fA-F]{6}$/', (string) $h ) ) ),
			);
		}

		/*
		 * Every (studio colour, candidate) distance first, then the claims are
		 * settled globally. Deciding colour by colour in deck order would let
		 * whichever studio id happens to be listed first take a colourway a
		 * nearer one wanted, which is an answer that depends on the order of
		 * `palettes.ts` rather than on the pixels.
		 */
		$pairs = array();
		foreach ( self::studio_colours() as $id => $colour ) {
			$lab    = self::lab_of_hex( $colour['hex'] );
			$family = Swatch::family( $lab );
			$any    = false;
			foreach ( $candidates as $i => $candidate ) {
				if ( $candidate['family'] !== $family || array() === $candidate['stops'] ) {
					continue;
				}
				$any  = true;
				$best = INF;
				foreach ( $candidate['labs'] as $stop ) {
					$best = min( $best, Swatch::delta( $lab, $stop ) );
				}
				$pairs[] = array(
					'studio' => $id,
					'cand'   => $i,
					'delta'  => $best,
				);
			}
			if ( ! $any ) {
				$refused[ $id ] = sprintf(
					/* translators: %s: a colour family heading, e.g. "Verts". */
					__( 'aucun coloris de la famille « %s » sur cette référence', 'teeshoop' ),
					Swatch::families()[ $family ] ?? $family
				);
			}
		}

		/*
		 * Nearest pair wins, then both ends leave the pool. Ties break on the
		 * two names so the answer cannot depend on the order WordPress returned
		 * the terms in: a purchase key that changes between two runs of the same
		 * command is a purchase key nobody can check.
		 */
		usort(
			$pairs,
			static function ( array $a, array $b ) use ( $candidates ): int {
				if ( $a['delta'] !== $b['delta'] ) {
					return $a['delta'] <=> $b['delta'];
				}
				$byname = strcmp( $candidates[ $a['cand'] ]['name'], $candidates[ $b['cand'] ]['name'] );
				return 0 !== $byname ? $byname : strcmp( $a['studio'], $b['studio'] );
			}
		);

		$taken_studio = array();
		$taken_cand   = array();
		foreach ( $pairs as $pair ) {
			if ( isset( $taken_studio[ $pair['studio'] ] ) || isset( $taken_cand[ $pair['cand'] ] ) ) {
				continue;
			}
			$taken_studio[ $pair['studio'] ] = true;
			$taken_cand[ $pair['cand'] ]     = true;
			$candidate                       = $candidates[ $pair['cand'] ];
			$deck[ $pair['studio'] ]         = array(
				'term'  => $candidate['name'],
				'name'  => $candidate['name'],
				'slug'  => $candidate['slug'],
				'stops' => $candidate['stops'],
				'delta' => round( (float) $pair['delta'], 4 ),
			);
		}

		foreach ( self::studio_colours() as $id => $colour ) {
			if ( ! isset( $deck[ $id ] ) && ! isset( $refused[ $id ] ) ) {
				$refused[ $id ] = __( 'le seul coloris de sa famille est déjà pris par une teinte plus proche', 'teeshoop' );
			}
		}

		return array(
			'deck'       => $deck,
			'refused'    => $refused,
			'unmeasured' => $unmeasured,
		);
	}

	/**
	 * The procurement half of the palette: studio dye id => the maker's name.
	 *
	 * The shape `Product::META_BLANK_COLOURS` has always had, so `Purchase.php`
	 * reads it unchanged. It is DERIVED from `palette()` rather than computed a
	 * second way, because a purchase key and a swatch that disagreed would send
	 * the workshop after a colour the customer never saw.
	 *
	 * @return array{map:array<string,string>,refused:array<string,string>,unmeasured:string[]}
	 */
	public static function colour_map( int $blank_id ): array {
		$palette = self::palette( $blank_id );
		$map     = array();
		foreach ( $palette['deck'] as $id => $entry ) {
			$map[ $id ] = $entry['term'];
		}
		return array(
			'map'        => $map,
			'refused'    => $palette['refused'],
			'unmeasured' => $palette['unmeasured'],
		);
	}

	/**
	 * The imported catalogue product for a reference, or 0.
	 *
	 * `Catalogue::find()` is the importer's own lookup, so a reference resolves
	 * the same way here as it does when the importer writes it. Doing it with a
	 * `meta_query` here would be a second reading of the same fact.
	 */
	private static function blank_product( string $ref ): int {
		return Importer::find( $ref );
	}

	/**
	 * Apply the range: create or refresh one buyable offer per reference.
	 *
	 * IDEMPOTENT AND REPORTED. Running it twice must change nothing the second
	 * time, and the report says what it did rather than "done": a command that
	 * prints success whatever it found is how 2 043 references were marked
	 * failed in one night and nobody noticed for five slices.
	 *
	 * @return array<int,array<string,mixed>> one row per reference, in RANGE order.
	 */
	public static function apply( bool $dry_run = false ): array {
		$rows = array();

		foreach ( self::RANGE as $ref => $garment ) {
			$ref = (string) $ref;
			$row = array(
				'ref'      => $ref,
				'garment'  => $garment,
				'blank_id' => 0,
				'offer_id' => 0,
				'name'     => '',
				'colours'  => 0,
				'refused'  => array(),
				'created'  => false,
				'changed'  => false,
				'why'      => '',
			);

			/*
			 * A GARMENT THE PRICE AUTHORITY DOES NOT KNOW IS A REFUSAL.
			 *
			 * `Product::garment_of()` reads the same config and answers '' for
			 * an unknown key, so an offer written with one would be published,
			 * purchasable and NOT personalisable: the worst of the three states,
			 * because a customer can pay for it and get nothing.
			 */
			if ( ! isset( Settings::pricing()['garments'][ $garment ] ) ) {
				$row['why'] = sprintf( 'le vêtement « %s » n’existe pas dans le tarif', $garment );
				$rows[]     = $row;
				continue;
			}

			$blank_id = self::blank_product( $ref );
			if ( $blank_id <= 0 ) {
				$row['why'] = 'la référence n’est pas dans le catalogue importé';
				$rows[]     = $row;
				continue;
			}
			$row['blank_id'] = $blank_id;

			$blank = wc_get_product( $blank_id );
			if ( ! $blank instanceof \WC_Product ) {
				$row['why'] = 'la référence est dans la base mais illisible';
				$rows[]     = $row;
				continue;
			}

			$image = (int) $blank->get_image_id();
			if ( $image <= 0 ) {
				/*
				 * NO PHOTOGRAPH, NO OFFER. A garment nobody can look at is not
				 * an offer (session 13b), and the print area of the next item
				 * is measured on that very photograph.
				 */
				$row['why'] = 'la référence n’a aucune photographie';
				$rows[]     = $row;
				continue;
			}

			$palette = self::palette( $blank_id );
			if ( array() === $palette['deck'] ) {
				$row['why'] = 'aucune couleur du studio ne correspond à un coloris mesuré de cette référence';
				$rows[]     = $row;
				continue;
			}
			$row['colours'] = count( $palette['deck'] );
			$row['refused'] = $palette['refused'];

			$name = self::offer_name( $blank, $garment );
			$slug = self::offer_slug( $ref, $blank );
			$row['name'] = $name;

			$offer = self::find_offer( $ref );
			$row['created'] = ! ( $offer instanceof \WC_Product );
			if ( $dry_run ) {
				$rows[] = $row;
				continue;
			}

			$offer = $offer instanceof \WC_Product ? $offer : new \WC_Product_Simple();
			$before = wp_json_encode( array( $offer->get_name(), $offer->get_regular_price(), $offer->get_image_id(), $offer->get_status() ) );

			$offer->set_name( $name );
			$offer->set_slug( $slug );
			$offer->set_status( 'publish' );
			$offer->set_catalog_visibility( 'visible' );
			$offer->set_image_id( $image );
			$offer->set_gallery_image_ids( array_map( 'intval', $blank->get_gallery_image_ids() ) );
			$offer->set_virtual( false );
			$offer->set_weight( (string) $blank->get_weight() );
			$offer->set_short_description( self::offer_teaser( $blank, $garment ) );
			$offer->set_description( self::offer_body( $blank, $garment ) );

			/*
			 * LE PRIX AFFICHÉ EST LU, PAS SAISI.
			 *
			 * Ce n'est pas le prix payé : `Pricing::quote()` recalcule chaque
			 * ligne à l'ajout au panier et à chaque passe de totaux, à partir de
			 * la quantité et de la surface réellement imprimée. C'est le prix à
			 * l'unité d'une face, celui que la grille annonce en tête, et
			 * WooCommerce en a besoin pour qu'un produit soit achetable du tout.
			 * Il est LU dans l'autorité de prix pour qu'il ne puisse pas en
			 * diverger : une deuxième copie du tarif écrite ici serait la
			 * deuxième implémentation que CLAUDE.md interdit.
			 */
			$rule = Settings::pricing()['garments'][ $garment ];
			$unit = (int) $rule['base_ht'] + (int) $rule['first_side_ht'];
			$offer->set_regular_price( number_format( Money::to_eur( $unit ), 2, '.', '' ) );

			$offer->update_meta_data( Product::META, $garment );
			$offer->update_meta_data( Product::META_BLANK_REF, $ref );
			$map  = array();
			$deck = array();
			foreach ( $palette['deck'] as $studio_id => $entry ) {
				$map[ $studio_id ] = $entry['term'];
				$deck[]            = array(
					'id'    => $studio_id,
					'name'  => $entry['name'],
					'stops' => $entry['stops'],
				);
			}
			$offer->update_meta_data( Product::META_BLANK_COLOURS, (string) wp_json_encode( $map ) );
			$offer->update_meta_data( Product::META_BLANK_PALETTE, (string) wp_json_encode( $deck ) );
			$offer->update_meta_data( self::META_SOURCE, $ref );

			/*
			 * The maker's own facts, carried over rather than restated. The
			 * product page prints matière and grammage when it has them and says
			 * nothing when it does not (Garments.php), so copying an absent
			 * value is copying an absence, which is the right answer.
			 */
			foreach ( array(
				Garments::META_BRAND      => (string) $blank->get_meta( Garments::META_BRAND, true ),
				Garments::META_BRAND_REF  => (string) $blank->get_meta( Garments::META_BRAND_REF, true ),
				Garments::META_MATERIAL   => (string) $blank->get_meta( Garments::META_MATERIAL, true ),
				Garments::META_WEIGHT     => (string) $blank->get_meta( Garments::META_WEIGHT, true ),
				Garments::META_SPECS_DATE => (string) $blank->get_meta( Garments::META_SPECS_DATE, true ),
			) as $key => $value ) {
				if ( '' !== $value ) {
					$offer->update_meta_data( $key, $value );
				}
			}

			$offer->save();
			$offer_id = (int) $offer->get_id();
			$row['offer_id'] = $offer_id;

			/*
			 * The offer lands in the same aisle as its blank, so the shop's
			 * navigation does not grow a second vocabulary. `Shelf` is what the
			 * importer used; reading its terms off the blank keeps one answer.
			 */
			$terms = wp_get_post_terms( $blank_id, 'product_cat', array( 'fields' => 'ids' ) );
			if ( is_array( $terms ) && array() !== $terms ) {
				wp_set_post_terms( $offer_id, array_map( 'intval', $terms ), 'product_cat' );
			}

			$after = wp_json_encode( array( $offer->get_name(), $offer->get_regular_price(), $offer->get_image_id(), $offer->get_status() ) );
			$row['changed'] = $row['created'] || $before !== $after;

			$rows[] = $row;
		}

		return $rows;
	}

	/** The offer for a reference, or null. */
	private static function find_offer( string $ref ): ?\WC_Product {
		$found = get_posts(
			array(
				'post_type'      => 'product',
				'post_status'    => 'any',
				'posts_per_page' => 1,
				'fields'         => 'ids',
				'meta_key'       => self::META_SOURCE, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- an operator command, not a page load.
				'meta_value'     => $ref, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- as above.
			)
		);
		if ( array() === $found ) {
			return null;
		}
		$product = wc_get_product( (int) $found[0] );
		return $product instanceof \WC_Product ? $product : null;
	}

	/**
	 * Le titre de l'offre, en français, à partir de ce que la référence est.
	 *
	 * Le nom du fournisseur est en anglais (« Gildan Heavy Cotton Adult
	 * T-Shirt ») et il est ce qu'un acheteur reconnaît, donc il reste, entre
	 * parenthèses, derrière ce que la page vend vraiment.
	 */
	private static function offer_name( \WC_Product $blank, string $garment ): string {
		/*
		 * Le nom du fournisseur EN PREMIER, parce que c'est celui qu'un acheteur
		 * professionnel reconnaît et compare (« B&C #E150 », « Gildan 5000 »).
		 * « à personnaliser » derrière, parce que c'est ce que la page vend et
		 * que la forme est neutre en genre : « personnalisé » s'accorderait avec
		 * un nom anglais dont on ne connaît pas le genre en français.
		 */
		unset( $garment );
		return $blank->get_name() . ' ' . __( 'à personnaliser', 'teeshoop' );
	}

	/**
	 * Le slug porte la référence, et c'est ce qui le rend stable.
	 *
	 * Le fournisseur renomme ses styles (« B&C #E150 T-Shirt » a été
	 * « B&C Exact 150 »), et un slug qui suit le titre casse chaque adresse
	 * indexée le jour où il le fait. La référence, elle, est sa clé et ne bouge
	 * pas. Le titre reste dans le slug pour ce qu'il vaut en référencement ;
	 * c'est la référence qui garantit l'unicité.
	 */
	private static function offer_slug( string $ref, \WC_Product $blank ): string {
		return sanitize_title( $blank->get_name() . '-a-personnaliser-' . $ref );
	}

	/** Une phrase, sans point d'exclamation, qui dit ce que la page vend. */
	private static function offer_teaser( \WC_Product $blank, string $garment ): string {
		$brand = (string) $blank->get_meta( Garments::META_BRAND, true );
		$piece = 'hoodie' === $garment ? 'Un sweat à capuche' : 'Un t-shirt';
		return sprintf(
			'%s %sà marquer avec votre logo, votre texte ou votre visuel. Imprimé en France, en transfert DTF, à partir de %d pièces.',
			$piece,
			'' !== $brand ? $brand . ' ' : '',
			(int) ( Settings::pricing()['min_qty'] ?? 1 )
		);
	}

	private static function offer_body( \WC_Product $blank, string $garment ): string {
		$piece = 'hoodie' === $garment ? 'Ce sweat' : 'Ce t-shirt';
		return sprintf(
			'%s est le textile nu sur lequel nous imprimons : %s. '
			. 'Vous choisissez la couleur, les tailles et l’emplacement du marquage dans le studio, '
			. 'et le prix suit la quantité et la surface réellement imprimée, pas la taille du fichier que vous nous envoyez.',
			$piece,
			$blank->get_name()
		);
	}

	/**
	 * Take the harness fixtures out of sale.
	 *
	 * DELISTED, NOT DELETED, and not hidden either. Emptying the price is what
	 * makes `WC_Product::is_purchasable()` answer no, which is the exact
	 * condition the launch portal and the cart both read. Setting the catalogue
	 * visibility to hidden would take them off the shelf and leave them buyable
	 * by anyone holding the URL, and « anything reachable by URL is public »
	 * (CLAUDE.md section 4).
	 *
	 * @return array<int,array{id:int,name:string,was:string}>
	 */
	public static function retire( bool $dry_run = false ): array {
		$out = array();
		foreach ( self::FIXTURES as $title ) {
			$found = get_posts(
				array(
					'post_type'      => 'product',
					'post_status'    => 'any',
					'posts_per_page' => -1,
					'fields'         => 'ids',
					'title'          => $title,
				)
			);
			foreach ( $found as $id ) {
				$product = wc_get_product( (int) $id );
				if ( ! $product instanceof \WC_Product ) {
					continue;
				}
				$was = (string) $product->get_regular_price();
				if ( '' === $was && '' === (string) $product->get_price() ) {
					continue;
				}
				$out[] = array(
					'id'   => (int) $id,
					'name' => $product->get_name(),
					'was'  => $was,
				);
				if ( $dry_run ) {
					continue;
				}
				$product->set_regular_price( '' );
				$product->set_sale_price( '' );
				$product->set_price( '' );
				$product->save();
			}
		}
		return $out;
	}

	/**
	 * What is on sale and personalisable right now, and what it declares.
	 *
	 * Reads the shop, never this file's own list: the point of a state command
	 * is to disagree with the intention when the two have drifted.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public static function state(): array {
		$query = wc_get_products(
			array(
				'status'   => 'publish',
				'limit'    => -1,
				'return'   => 'objects',
				'paginate' => true,
			)
		);
		$products = is_object( $query ) && isset( $query->products ) && is_array( $query->products ) ? $query->products : array();

		$out = array();
		foreach ( $products as $product ) {
			if ( ! $product instanceof \WC_Product ) {
				continue;
			}
			$garment = Product::garment_of( $product->get_id() );
			/*
			 * Un produit ni personnalisable ni achetable n'a rien à faire dans
			 * ce relevé. Les deux autres combinaisons, si : « achetable et pas
			 * personnalisable » est un client qui paie et ne reçoit aucun
			 * marquage, et « personnalisable et pas achetable » est une page
			 * dont le bouton Personnaliser ne mène nulle part.
			 */
			if ( '' === $garment && ! $product->is_purchasable() ) {
				continue;
			}
			$out[] = array(
				'id'          => (int) $product->get_id(),
				'name'        => $product->get_name(),
				'garment'     => $garment,
				'blank_ref'   => Product::blank_ref_of( $product->get_id() ),
				'colours'     => count( Product::blank_colours_of( $product->get_id() ) ),
				'purchasable' => $product->is_purchasable(),
				'ours'        => '' !== (string) $product->get_meta( self::META_SOURCE, true ),
			);
		}
		usort( $out, static fn( array $a, array $b ): int => $a['id'] <=> $b['id'] );
		return $out;
	}
}
