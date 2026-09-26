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
	 * Reconnus par leur TITRE EXACT, et c'est ce que `retire()` fait. Le
	 * commentaire disait « par leur slug ou, à défaut, par leur titre », ce qui
	 * n'a jamais été vrai : la liste ne contient que des titres et la requête
	 * n'interroge que `title`. La conséquence est réelle et elle est ici plutôt
	 * que dans une promesse : renommer un montage de harnais le remet en vente
	 * en silence, et la commande annonce « 0 montage(s) sortis de la vente »
	 * sans rien de rouge. Le jour où ça arrive, c'est cette liste qu'il faut
	 * mettre à jour, pas le code.
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
		/*
		 * ── UN COLORIS QUI MANQUE DANS UNE TAILLE N'EST PAS PROPOSÉ DU TOUT ───
		 *
		 * Le studio offre toutes ses tailles quelle que soit la couleur. Le
		 * fournisseur, non : il arrête des coloris dans les grandes tailles.
		 * Mesuré le 4 septembre 2026 sur les neuf offres, 936 paires
		 * (coloris, taille) : DIX sont invendables, dont toute la ligne 3XL du
		 * Fruit of the Loom Classic Hooded (neuf coloris) et le S Orange en 3XL
		 * du Gildan Heavy Blend.
		 *
		 * Sans ce filtre, le client choisit la couleur, choisit le 3XL, paie, et
		 * c'est le bon de commande fournisseur qui refuse par son nom :
		 * « Le fournisseur ne vend pas la taille 3XL en Bottle Green ». Après le
		 * paiement, sur une commande dont le film est peut-être déjà imprimé.
		 *
		 * Le coloris est donc retenu seulement s'il existe dans TOUTES les
		 * tailles que le studio presse. C'est un nuancier plus court et vrai
		 * plutôt qu'un plus long qui refuse en caisse.
		 */
		$sellable = self::colours_in_every_size( $blank_id );

		$candidates = array();
		foreach ( $terms as $term ) {
			$read = Colours::read( (int) $term->term_id );
			if ( null === $read || array() === $read['labs'] || '' === (string) $read['family'] ) {
				$unmeasured[] = (string) $term->name;
				continue;
			}
			if ( ! isset( $sellable[ strtolower( (string) $term->name ) ] ) ) {
				$unmeasured[] = (string) $term->name . ' (absent d’au moins une taille)';
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
	 * Les coloris de cette référence qui existent dans CHAQUE taille pressée.
	 *
	 * Voir le commentaire au point d'appel. Rend une carte nom minuscule => vrai.
	 *
	 * @return array<string,bool>
	 */
	private static function colours_in_every_size( int $blank_id ): array {
		$blank = wc_get_product( $blank_id );
		if ( ! $blank instanceof \WC_Product ) {
			return array();
		}
		/*
		 * ── LA RÈGLE « QUEL VÊTEMENT EST CETTE RÉFÉRENCE » N'EXISTE QU'UNE FOIS ─
		 *
		 * Cette ligne lisait `RANGE`, la liste de neuf tenue à la main, alors que
		 * `range()` DÉRIVE la gamme du catalogue depuis le 9 septembre 2026.
		 * Conséquence mesurée sur le miroir : pour les 448 références dérivées,
		 * `$garment` sortait vide, donc aucune taille, donc AUCUN coloris
		 * n'existait « dans toutes les tailles », donc nuancier vide, et la
		 * commande annonçait « aucune couleur du studio ne correspond à un
		 * coloris mesuré » sur des références dont 37 coloris sur 40 étaient
		 * parfaitement mesurés. Un message qui envoie chercher la mesure quand
		 * c'est la taille qui manque coûte une soirée à celui qui le lit.
		 */
		$garment = self::garment_for(
			(string) get_post_meta( $blank_id, Catalogue::META_REF, true ),
			(string) get_post_meta( $blank_id, Catalogue::META_FAMILY, true )
		);
		$sizes   = '' === $garment ? array() : array_map( 'strtolower', ProductPage::size_ids( $garment ) );
		if ( array() === $sizes ) {
			return array();
		}

		/* colour name (lowercased) => the set of sizes it exists in. */
		$seen = array();
		foreach ( $blank->get_children() as $child ) {
			$variation = wc_get_product( (int) $child );
			if ( ! $variation instanceof \WC_Product_Variation ) {
				continue;
			}
			$attributes = $variation->get_attributes();
			$size       = strtolower( (string) ( $attributes['pa_taille'] ?? '' ) );
			if ( ! in_array( $size, $sizes, true ) ) {
				continue;
			}
			$term = get_term_by( 'slug', (string) ( $attributes['pa_couleur'] ?? '' ), Colours::TAXONOMY );
			if ( ! $term instanceof \WP_Term ) {
				continue;
			}
			$seen[ strtolower( $term->name ) ][ $size ] = true;
		}

		$out = array();
		foreach ( $seen as $name => $found ) {
			if ( count( $found ) === count( array_unique( $sizes ) ) ) {
				$out[ $name ] = true;
			}
		}
		return $out;
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
	/** L'option qui dit jusqu'où la gamme va. Voir portee() et range(). */
	public const OPTION_PORTEE = 'teeshoop_gamme_portee';

	/**
	 * La famille du catalogue vers le vêtement du studio qui l'imprime.
	 *
	 * `PriceRule::family_of_garment()` fait déjà le trajet inverse et c'est la
	 * même table lue dans l'autre sens : un sweat à capuche s'imprime sur le
	 * modèle « hoodie », un polo sur le gabarit du t-shirt faute de modèle
	 * propre. Ce dernier point est une approximation ASSUMÉE et pas un oubli :
	 * la zone d'impression d'un polo est plus étroite que celle d'un t-shirt à
	 * cause du col, donc elle est bornée par le gabarit du studio et jamais
	 * élargie. Cinq polos sont concernés.
	 */
	public const FAMILLES = array(
		'tee'   => 'tee',
		'sweat' => 'hoodie',
		'polo'  => 'tee',
	);

	/**
	 * Le vêtement du studio sous lequel une référence se vend, ou ''.
	 *
	 * ÉCRITE UNE FOIS PARCE QUE DEUX LECTURES ONT DÉJÀ DIVERGÉ. `range()`
	 * dérivait le vêtement du rayon du catalogue pendant que
	 * `colours_in_every_size()` le cherchait encore dans la liste de neuf tenue
	 * à la main, et la deuxième répondait '' pour les 448 références que la
	 * première venait d'ouvrir. Le rayon décide ; la liste tenue à la main ne
	 * sert plus qu'aux références qu'aucun rayon connu ne couvre.
	 *
	 * @param string $ref     La référence fournisseur.
	 * @param string $famille Le rayon écrit par l'import.
	 */
	public static function garment_for( string $ref, string $famille ): string {
		return self::FAMILLES[ $famille ] ?? ( self::RANGE[ $ref ] ?? '' );
	}

	/** « lancement » (les neuf choisies) ou « catalogue » (tout ce qui tient). */
	public static function portee(): string {
		return 'catalogue' === (string) get_option( self::OPTION_PORTEE, 'lancement' ) ? 'catalogue' : 'lancement';
	}

	/**
	 * Les références à ouvrir à la personnalisation, référence => vêtement.
	 *
	 * ── POURQUOI CE N'EST PLUS UNE CONSTANTE ────────────────────────────────
	 *
	 * `RANGE` compte neuf références choisies à la main, dans une fourchette de
	 * prix d'achat étroite, parce que le tarif publié est UN PAR VÊTEMENT DU
	 * STUDIO : un seul prix pour tous les t-shirts. La crainte était qu'ouvrir
	 * le catalogue entier vende les nus chers à perte.
	 *
	 * MESURÉ LE 5 SEPTEMBRE 2026 SUR LE CATALOGUE RÉEL, et la mesure a démenti
	 * la crainte : sur 319 références importées, CINQ seulement passent sous
	 * leur plancher au tarif de leur famille (3 t-shirts Tee Jays, 1 polo
	 * Spiro, 1 sweat Tee Jays). Les 314 autres tiennent. L'écart de prix
	 * d'achat va bien de 1 à 29, mais il est porté par une poignée d'extrêmes.
	 *
	 * La règle est donc : on ouvre tout, et le PLANCHER exclut les rares
	 * références qui ne peuvent pas se vendre à ce tarif. C'est un refus
	 * mesuré par référence, pas une liste tenue à la main qui vieillit.
	 *
	 * ── CE QUI RESTE VRAI ET N'EST PAS RÉGLÉ ICI ────────────────────────────
	 *
	 * Un nu à 0,93 EUR et un nu à 6,14 se vendent au même prix, parce que le
	 * tarif est par famille. Ce n'est pas une perte, c'est le modèle de la
	 * boutique, et le changer est une décision commerciale et non technique.
	 * `Pricing::quote()` sait depuis le 5 septembre recevoir un prix de nu par
	 * référence ; personne ne le lui passe encore.
	 *
	 * @return array<string,string> référence fournisseur => vêtement du studio.
	 */
	public static function range( ?string $portee = null ): array {
		// LA PORTÉE PEUT ÊTRE IMPOSÉE, pour qu'une SIMULATION simule ce qu'on lui
		// demande et non ce qui est enregistré. Une simulation qui répond sur un
		// autre périmètre que celui demandé ne prouve rien.
		if ( 'catalogue' !== ( $portee ?? self::portee() ) ) {
			return self::RANGE;
		}

		/*
		 * ─────────────────────────────────────────────────────────────────────
		 * LA PORTÉE « CATALOGUE » EST FERMÉE DEPUIS LE 9 SEPTEMBRE 2026, ET LA
		 * RAISON EST QUE SA MESURE D'OUVERTURE ÉTAIT FAUSSE.
		 *
		 * Le 5 septembre, cette règle a remplacé neuf références choisies à la
		 * main par « on ouvre tout, et le plancher exclut », sur une mesure qui
		 * annonçait cinq références en défaut sur 319. Une passe adversariale a
		 * refait la mesure le 9 septembre et le plancher utilisé n'est pas celui
		 * de la boutique, deux fois plutôt qu'une :
		 *
		 *   il n'a QU'UNE JAMBE. `Margin::plan()` définit le plancher comme le
		 *   MAXIMUM entre la contribution minimale et la marge brute minimale
		 *   (50 %), et cette ligne ne calcule que la première ;
		 *
		 *   et il compare la moitié TEXTILE du prix à la moitié TEXTILE du coût,
		 *   en ignorant le marquage, le film, l'emballage et les coûts par
		 *   commande, que `Pricing` dit pourtant que `base_ht` doit porter aussi.
		 *
		 * Mesuré avec le vrai chemin de coût, sur 25 pièces une face à la taille
		 * la plus chère : 202 des 280 offres publiées se vendaient SOUS leur
		 * plancher, dont une à 4,4 % de marge brute contre 50 % exigés. Le tarif
		 * publié supporte un textile nu jusqu'à 6,65 EUR sur un t-shirt et 21,28
		 * sur un sweat ; cette règle en admettait 18,00 et 47,25.
		 *
		 * ET AUCUNE GARDE NE POUVAIT LE VOIR : `integration-grille.php` boucle
		 * sur les neuf constantes tenues à la main, donc elle ne regarde aucune
		 * des 448 références que cette règle ajoutait.
		 *
		 * ON REFUSE PLUTÔT QUE DE CORRIGER AU JUGÉ. Le bon plancher demande le
		 * vrai chemin de coût, celui que la suite d'intégration interroge, et le
		 * réécrire ici serait une SECONDE implémentation du modèle de coût,
		 * c'est-à-dire exactement ce qui a produit ce défaut. La boutique
		 * retombe donc sur les neuf références mesurées une par une, ce qui est
		 * l'état d'avant le 5 septembre et un état sûr.
		 *
		 * CE QU'IL FAUT FAIRE POUR ROUVRIR, écrit pour la prochaine séance :
		 * construire la colonne publiée la moins chère de chaque référence, à sa
		 * taille et son coloris les plus chers, et refuser la référence quand sa
		 * recette n'atteint pas le `floor_ht` de `Margin::plan()` sur le coût
		 * direct COMPLET, en passant par `Costing` et non par une arithmétique
		 * écrite ici. Puis pointer `integration-grille.php` sur `Gamme::range()`
		 * pour que la correction soit gardée.
		 */
		return self::RANGE;

		global $wpdb;
		$config  = Settings::pricing();
		$cc      = Cost::merge_config( (array) get_option( 'teeshoop_cost_config', array() ) );
		$taux    = (float) ( $cc['min_contribution_rate'] ?? 0.25 );

		/*
		 * LE COÛT DU NU EST PRIS À LA TAILLE LA PLUS CHÈRE. Une référence a un
		 * prix d'achat par taille ; publier un tarif qui ne tient que pour le M
		 * vend le 3XL sous son coût. Voir Catalogue::blank_cost_ht(), qui porte
		 * la même règle pour un produit unique ; ici elle est faite en une
		 * requête parce que la boucle en ferait trois cents.
		 */
		/*
		 * ON COMPTE AUSSI LES ARTICLES SANS COÛT, ET C'EST UNE CORRECTION.
		 *
		 * Le `> 0` filtrait les déclinaisons sans prix d'achat enregistré, donc
		 * le plancher se calculait sur un SOUS-ENSEMBLE de la référence, et une
		 * référence dont l'article le plus cher est justement celui qu'on n'a pas
		 * su lire s'ouvrait à la vente sur la foi des autres. Le garde-fou deux
		 * paragraphes plus bas ne couvrait que le cas d'une référence sans AUCUN
		 * coût. Relevé sur le miroir le 9 septembre 2026 : JKJT150 (103
		 * déclinaisons dont 97 chiffrées) et JKST150 (162 dont 158) étaient
		 * ouvertes ainsi. Inoffensif à leur niveau de prix, réel comme mécanisme.
		 *
		 * « On n'a pas su lire » n'est pas « c'est gratuit », et la réponse
		 * conservatrice est de ne pas ouvrir la référence du tout.
		 */
		$couts   = array();
		$trous   = array();
		$lignes  = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT v.post_parent AS ref_id,
				        MAX(CAST(sc.meta_value AS UNSIGNED)) AS maxi,
				        SUM(CASE WHEN CAST(sc.meta_value AS UNSIGNED) > 0 THEN 0 ELSE 1 END) AS sans_cout
				   FROM {$wpdb->postmeta} sc
				   JOIN {$wpdb->posts} v ON v.ID = sc.post_id AND v.post_type = 'product_variation'
				  WHERE sc.meta_key = %s
				  GROUP BY v.post_parent",
				Catalogue::META_SUPPLY_CENTS
			)
		);
		foreach ( $lignes as $l ) {
			$couts[ (int) $l->ref_id ] = (int) $l->maxi;
			$trous[ (int) $l->ref_id ] = (int) $l->sans_cout;
		}

		$refs = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT p.ID, r.meta_value AS ref, f.meta_value AS famille
				   FROM {$wpdb->posts} p
				   JOIN {$wpdb->postmeta} r ON r.post_id = p.ID AND r.meta_key = %s
				   JOIN {$wpdb->postmeta} f ON f.post_id = p.ID AND f.meta_key = %s
				  WHERE p.post_type = 'product' AND p.post_status = 'publish'",
				Catalogue::META_REF,
				Catalogue::META_FAMILY
			)
		);

		$out = self::RANGE;
		foreach ( $refs as $r ) {
			$garment = self::garment_for( (string) $r->ref, (string) $r->famille );
			if ( '' === $garment || ! isset( $config['garments'][ $garment ] ) ) {
				continue;
			}
			// UN COÛT INCONNU NE S'OUVRE PAS. « On n'a pas pu lire » n'est pas
			// « c'est gratuit » : sans prix d'achat, aucun plancher n'est
			// calculable et la référence resterait invendable en silence.
			if ( ! isset( $couts[ (int) $r->ID ] ) || $couts[ (int) $r->ID ] <= 0 ) {
				continue;
			}
			// Et une seule déclinaison sans coût suffit à refermer la référence :
			// le plancher se calcule sur le pire article, et on ne connaît pas
			// celui-là.
			if ( ( $trous[ (int) $r->ID ] ?? 0 ) > 0 ) {
				continue;
			}
			$plancher = Margin::floor_price_rate( $couts[ (int) $r->ID ], $taux, 0.0 );
			if ( (int) $config['garments'][ $garment ]['base_ht'] < $plancher ) {
				continue;
			}
			$out[ (string) $r->ref ] = $garment;
		}
		return $out;
	}

	public static function apply( bool $dry_run = false, ?string $portee = null ): array {
		$rows = array();

		foreach ( self::range( $portee ) as $ref => $garment ) {
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
				$row['why']     = 'la référence n’est pas dans le catalogue importé';
				$row['retired'] = self::withdraw( $ref, $dry_run );
				$rows[]         = $row;
				continue;
			}
			$row['blank_id'] = $blank_id;

			$blank = wc_get_product( $blank_id );
			if ( ! $blank instanceof \WC_Product ) {
				$row['why'] = 'la référence est dans la base mais illisible';
				$rows[]     = $row;
				continue;
			}
			/*
			 * UN TEXTILE NU DÉPUBLIÉ RETIRE SON OFFRE (FOU-06). `blank_product()`
			 * trouve aussi un brouillon, donc une référence que l'import a
			 * dépubliée (le fournisseur ne la liste plus) gardait son offre en
			 * vente, avec son prix et son nuancier d'avant : le client dessinait,
			 * puis le panier refusait.
			 */
			if ( 'publish' !== $blank->get_status() ) {
				$row['why']     = 'le textile nu n’est plus en vente (dépublié par l’import)';
				$row['retired'] = self::withdraw( $ref, $dry_run );
				$rows[]         = $row;
				continue;
			}

			$image = (int) $blank->get_image_id();
			if ( $image <= 0 ) {
				/*
				 * NO PHOTOGRAPH, NO OFFER. A garment nobody can look at is not
				 * an offer (session 13b), and the print area of the next item
				 * is measured on that very photograph.
				 */
				$row['why']     = 'la référence n’a aucune photographie';
				$row['retired'] = self::withdraw( $ref, $dry_run );
				$rows[]         = $row;
				continue;
			}

			$palette = self::palette( $blank_id );
			if ( array() === $palette['deck'] ) {
				$row['why']     = 'aucune couleur du studio ne correspond à un coloris mesuré de cette référence';
				$row['retired'] = self::withdraw( $ref, $dry_run );
				$rows[]         = $row;
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
			$offer->set_weight( self::heaviest_weight( $blank ) );
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
				/*
				 * LA GRILLE DE TAILLES DU FABRICANT, et elle a une raison d'être
				 * là plutôt que d'être lue chez le textile nu au moment du rendu.
				 *
				 * `scripts/zones-mesurer.mjs` l'écrit sur la référence importée,
				 * qui est un AUTRE produit que cette offre. Sans cette copie, la
				 * fiche retombait sur la charte du studio et publiait 52,0 cm de
				 * demi-poitrine en M sous le nom « B&C TU01T », là où B&C écrit
				 * 50 sur sa propre fiche. Deux centimètres d'erreur, sur la ligne
				 * où un acheteur choisit sa taille.
				 *
				 * Copiée et pas lue en direct, comme la marque et la matière au-
				 * dessus : ce qui est vendu est ce que l'offre porte, et une
				 * référence retirée du catalogue ne doit pas vider une fiche.
				 */
			) as $key => $value ) {
				if ( '' !== $value ) {
					$offer->update_meta_data( $key, $value );
				}
			}

			/*
			 * LA GRILLE DE TAILLES SE COPIE OU S'EFFACE, jamais « on garde
			 * l'ancienne ».
			 *
			 * Les autres faits du fabricant se copient seulement s'ils existent :
			 * une matière absente n'efface pas celle qu'on avait. Celle-ci est
			 * différente, parce que `zones-mesurer` la RETIRE quand il découvre
			 * qu'elle était mal lue ou incomplète. La laisser en place ferait
			 * survivre sur la fiche produit exactement la série que le contrôle
			 * vient de refuser, et c'est le guide des tailles qu'un acheteur
			 * professionnel lit.
			 */
			$chart = (string) $blank->get_meta( '_teeshoop_demi_poitrine', true );
			if ( '' === $chart ) {
				$offer->delete_meta_data( '_teeshoop_demi_poitrine' );
			} else {
				$offer->update_meta_data( '_teeshoop_demi_poitrine', $chart );
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

	/**
	 * Le poids de l'offre : le plus lourd de la référence, en kilogrammes.
	 *
	 * ── POURQUOI PAS CELUI DU PARENT ───────────────────────────────────────────
	 *
	 * Il n'y en a pas. WooCommerce porte le poids sur la DÉCLINAISON, et
	 * l'importateur y écrit celui du fournisseur ; le produit variable parent
	 * reste vide. Copié tel quel, il donnait une offre sans poids, et
	 * `Shipping` refusait alors de chiffrer le port : mesuré le 4 septembre
	 * 2026, « Le poids d'un des articles du panier n'est pas renseigné », donc
	 * ZÉRO EURO de livraison dans le coût et zéro dans l'encaissé. Le plancher
	 * était calculé sans le port et la boutique se croyait au-dessus.
	 *
	 * ── POURQUOI LE PLUS LOURD ─────────────────────────────────────────────────
	 *
	 * Parce que le client choisit sa couleur et sa taille, et que les deux
	 * pèsent. Mesuré sur le Fruit of the Loom Classic Hooded : 0,45 kg en blanc
	 * et 0,46 kg en noir, à taille égale. La grille Colissimo est par TRANCHE :
	 * un colis sous-pesé bascule d'une tranche et le port est facturé sous son
	 * coût, ce qui sort de la marge. Le plus lourd est la seule valeur dont on
	 * sait qu'aucune commande ne la dépasse.
	 */
	private static function heaviest_weight( \WC_Product $blank ): string {
		$max = 0.0;
		foreach ( $blank->get_children() as $child ) {
			$variation = wc_get_product( (int) $child );
			if ( ! $variation instanceof \WC_Product ) {
				continue;
			}
			$weight = (string) $variation->get_weight();
			if ( '' !== $weight && is_numeric( $weight ) ) {
				$max = max( $max, (float) $weight );
			}
		}
		/*
		 * Une référence dont aucune déclinaison ne porte de poids rend '', et
		 * c'est ce qu'il faut : `Shipping` sait dire « je n'ai pas pu regarder »
		 * et refuse de chiffrer, ce qui remonte comme un coût inconnu. Écrire un
		 * poids par défaut ferait passer une devinette pour une mesure sur la
		 * ligne qui décide de la tranche transporteur.
		 */
		return $max > 0 ? (string) $max : '';
	}

	/**
	 * Une offre dont la référence ne se résout plus SORT DE LA VENTE.
	 *
	 * ── POURQUOI « CONTINUE » NE SUFFISAIT PAS ────────────────────────────────
	 *
	 * `apply()` se dit idempotente, et elle l'était sur son chemin heureux
	 * seulement : quand une référence disparaissait du catalogue, perdait sa
	 * photographie ou n'avait plus un seul coloris mesuré, la boucle passait à
	 * la suivante SANS TOUCHER à l'offre déjà publiée. La boutique continuait
	 * donc de vendre un vêtement dont le textile nu n'existe plus, avec la carte
	 * de coloris et le poids de la semaine dernière, et l'état de la boutique
	 * dépendait de son historique plutôt que de `RANGE`.
	 *
	 * L'offre perd son prix, comme les montages de harnais, pour la même raison :
	 * c'est ce que `is_purchasable()` lit, donc ce que le panier et le portail de
	 * mise en ligne lisent. Elle n'est pas supprimée, parce qu'une commande
	 * passée la référence encore.
	 *
	 * @return bool true si une offre a effectivement été retirée.
	 */
	private static function withdraw( string $ref, bool $dry_run ): bool {
		$offer = self::find_offer( $ref );
		if ( ! $offer instanceof \WC_Product || '' === (string) $offer->get_regular_price() ) {
			return false;
		}
		if ( ! $dry_run ) {
			$offer->set_regular_price( '' );
			$offer->set_sale_price( '' );
			$offer->set_price( '' );
			$offer->save();
		}
		return true;
	}

	/**
	 * Withdraw the offer sold on a blank the importer has just unpublished.
	 *
	 * Called by `Importer::delist()` for each reference it takes off the shop,
	 * so an offer stops selling the moment its blank does, not at the next
	 * « teeshoop gamme appliquer » somebody remembers to run (FOU-06).
	 */
	public static function withdraw_offer_of( string $ref ): bool {
		return self::withdraw( $ref, false );
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
	 * Le slug de l'offre : le nom du textile, jamais la référence du grossiste.
	 *
	 * LA RÉFÉRENCE EN EST SORTIE LE 26/09/2026 (FOU-07). Elle garantissait
	 * l'unicité, et elle publiait dans chaque adresse de fiche, d'atelier, du plan
	 * de site et de chaque lien, la valeur que `Shelf::SEALED` retire partout
	 * ailleurs : la référence du grossiste, qui est le préfixe littéral de ses
	 * numéros d'article. Le nom du textile porte déjà la référence du FABRICANT
	 * (« B&C #E150 »), qui est publique ; l'unicité restante est celle que
	 * WordPress assure lui-même (`wp_unique_post_slug`).
	 *
	 * UNE ADRESSE QUI CHANGE REDIRIGE. `apply()` réécrit le slug, WooCommerce
	 * enregistre par `wp_update_post`, et WordPress garde l'ancien dans
	 * `_wp_old_slug` : l'ancienne adresse d'une fiche répond par une redirection
	 * permanente vers la nouvelle.
	 */
	private static function offer_slug( string $ref, \WC_Product $blank ): string {
		unset( $ref );
		return sanitize_title( $blank->get_name() . '-a-personnaliser' );
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
