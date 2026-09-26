<?php
/**
 * The colour swatches: where the photographs come from and where the answer goes.
 *
 * `Swatch` is the arithmetic and knows nothing about a shop. This half knows
 * about the shop and does no arithmetic: it builds the list of photographs that
 * belong to a colour name, fetches them, hands the pixels over, and writes the
 * verdict onto the term. Splitting them that way is what lets
 * `tests/run.php` exercise every branch of the measurement on a machine with
 * neither WordPress nor GD installed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TROIS SOURCES, DANS L'ORDRE DE LEUR ERREUR DE MESURE
 *
 * 1. LA TEINTE DÉCLARÉE (`Catalogue::META_COLOUR_HEX`). Depuis le 9 septembre
 *    2026 le fournisseur énonce la couleur en chiffres et non plus en image.
 *    C'est la même affirmation que la pastille ci-dessous, sans la compression
 *    JPEG, sans la lampe et sans le détourage : donc la meilleure des trois, et
 *    elle est essayée la première. AUCUN TÉLÉCHARGEMENT sur ce chemin.
 *
 * 2. LA PASTILLE DU FABRICANT (`Catalogue::META_COLOUR_CHIP`), une image d'un
 *    aplat de la teinture, mesurée entre 99,2 % et 100 % uniforme sur onze
 *    d'entre elles. C'est ce que livrait l'ancien fournisseur, et c'est ce que
 *    portent encore les 46 572 déclinaisons importées avant cette date.
 *
 * 3. LA PHOTOGRAPHIE DU VÊTEMENT (`Catalogue::META_COLOUR_PHOTO`), par le
 *    détourage que `Swatch::measure()` existe pour faire. Ce n'est pas un
 *    pis-aller inventé : le nouveau fournisseur publie un jeu d'images PAR
 *    coloris (mesuré sur 154 produits multicolores, 154 en ont un différent par
 *    coloris, zéro le partagent), donc c'est une mesure du vrai vêtement.
 *
 * Quand la pastille répond, la photographie sert de CONTRÔLE et son écart est
 * enregistré : le fournisseur est connu pour réutiliser la photo d'un coloris
 * pour un autre, et c'est la forme que prend cette panne. Le désaccord est
 * rapporté à l'opérateur, jamais utilisé pour refuser la pastille.
 *
 * CE CONTRÔLE NE TOURNE PAS SUR LA TEINTE DÉCLARÉE, et c'est délibéré.
 * `PHOTO_MAX` a été réglé sur la distribution mesurée pastille contre photo ; la
 * distance d'un nombre déclaré à un vêtement éclairé n'a pas la même
 * distribution et n'a jamais été relevée. Publier ce nombre sous le même seuil
 * serait un chiffre qu'on ne sait pas lire, et cela coûterait un
 * téléchargement de 1,6 Mo par coloris pour l'obtenir.
 *
 * Si rien de tout cela n'existe, le coloris est REFUSÉ avec son motif. Peindre
 * un gris sous un vrai nom de couleur est le défaut que tout ce fichier existe
 * pour supprimer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THEY ARE
 *
 * Not on the term. WooCommerce puts the colour on a VARIATION as the plain
 * meta `attribute_pa_couleur` holding a term slug, and the importer puts that
 * colourway's declared hexadecimal, chip and photograph beside it. So one
 * grouped query over four meta keys gives every (colour, hexadecimal, chip,
 * photograph) row in the shop, and the parent product is never touched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO CACHE, AND THAT IS A MEASURED DECISION
 *
 * The obvious design caches each photograph's measurement so a re-run is free.
 * MEASURED on the mirror: `wp_remote_get` returns a supplier photograph through
 * the Worker in 57 ms and `Swatch` measures it in 26 ms, so a full sweep of 442
 * colours at five photographs each is under four minutes, and the resume is at
 * the COLOUR, which is the unit anybody actually re-runs. A cache would be a
 * second copy of every measurement, keyed by a supplier filename, living in an
 * option that has to be invalidated the day a threshold in `Swatch` moves. The
 * cost of not having it is three minutes; the cost of having it is a stale
 * swatch nobody can explain.
 *
 * RE-MESURÉ LE 9 SEPTEMBRE 2026, sur un catalogue qui a quintuplé : 1 331
 * coloris, `--recommencer`, 6 311 images, 181 s en tout. La conclusion tient.
 * Ce qui a changé, et qui compte davantage, c'est que `work_list()` met 21,6 s
 * à elle seule et qu'elle est appelée DEUX fois par commande (une fois par la
 * commande pour savoir s'il y a du travail, une fois par `sweep()`). Ce coût
 * est antérieur à la teinte déclarée : la même requête sans sa jointure met
 * 20,3 s. C'est la taille du catalogue, pas le nombre de jointures.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Colours {

	/** The attribute the shop calls a colour. */
	public const TAXONOMY = 'pa_couleur';

	/*
	 * The verdict, on the term.
	 *
	 * `STOPS` holds one hexadecimal, or two separated by a space for a two-tone
	 * colourway. `WHY` holds the refusal when there is no swatch, and the two
	 * are mutually exclusive by construction in `store()`: a term can never
	 * carry both a colour and a reason it has none.
	 */
	public const META_STOPS  = '_teeshoop_swatch';
	public const META_FAMILY = '_teeshoop_swatch_famille';
	public const META_LAB    = '_teeshoop_swatch_lab';
	public const META_PHOTOS = '_teeshoop_swatch_photos';
	public const META_WHY    = '_teeshoop_swatch_refus';
	public const META_AT     = '_teeshoop_swatch_date';

	/** Which of the three sources answered. */
	public const META_SOURCE = '_teeshoop_swatch_source';

	/**
	 * The three answers `META_SOURCE` can hold, named once.
	 *
	 * `scripts/couleurs-guard.mjs` keeps its own copy of this list, on purpose
	 * and not by importing it: it is a gate on the committed record, and a gate
	 * that reads its expectations from the code it checks agrees with itself
	 * whatever the code does.
	 */
	public const SOURCE_DECLAREE = 'déclarée';
	public const SOURCE_PASTILLE = 'pastille';
	public const SOURCE_PHOTO    = 'photo';

	/** How far the garment photograph sat from the chip. Operator diagnostic. */
	public const META_ECART  = '_teeshoop_swatch_ecart';

	/**
	 * How far the images of one colour were from each other, in OKLab.
	 *
	 * `Swatch::aggregate()` has always computed this and nothing kept it. It is
	 * the only number in the system that says how well a colour is KNOWN, and
	 * without it the width of the near-neutral band where the maker's word wins
	 * (`Swatch::S_FLOU`) is a judgement rather than a measurement. Stored so the
	 * next session can derive it.
	 */
	public const META_SPREAD = '_teeshoop_swatch_ecart_images';

	/** Every key a verdict owns, so `store()` can clear exactly the stale ones. */
	private const META_VERDICT = array(
		self::META_STOPS,
		self::META_FAMILY,
		self::META_LAB,
		self::META_PHOTOS,
		self::META_WHY,
		self::META_SOURCE,
		self::META_ECART,
		self::META_SPREAD,
		self::META_AT,
	);

	/**
	 * How many photographs of one colour are enough.
	 *
	 * Every extra photograph is a fetch, and the value of the fifth is small: it
	 * moves a median that four have already fixed. What the several photographs
	 * are really for is DISAGREEMENT, which is why the count matters at all. One
	 * photograph can never disagree with anything and a colour measured from one
	 * is published with `photos = 1` on the record, so the state command can say
	 * how much of the catalogue rests on a single shot.
	 */
	public const PHOTOS_PER_COLOUR = 5;

	/** Where the reviewable record of a sweep is written. */
	public const LEDGER = 'docs/couleurs.json';

	/**
	 * How far a garment photograph may sit from its own colour chip.
	 *
	 * OKLab euclidean, and it is generous on purpose: a chip is the dye and a
	 * photograph is that dye under a lamp, on a fabric with its own sheen, so
	 * they are never going to match. What this is looking for is the case where
	 * they are not the same colour AT ALL, which is a photograph of another
	 * colourway, a failure this supplier is already known for.
	 *
	 * Set from the sweep's own distribution rather than from taste: see
	 * docs/COULEURS.md for where the two sources actually land.
	 */
	public const PHOTO_MAX = 0.12;

	/**
	 * Every (colour term, declared hexadecimal, chip, photograph) row the shop holds.
	 *
	 * Sorted so a re-run measures the same images in the same order on every
	 * machine: without that the ledger's diff is noise and the spread figure
	 * moves for no reason.
	 *
	 * @return array<string,array{hex:string[],chips:string[],photos:string[]}>
	 */
	public static function work_list( int $per_colour = self::PHOTOS_PER_COLOUR ): array {
		global $wpdb;

		/*
		 * THE COLOUR DRIVES THE QUERY, NOT THE PHOTOGRAPH.
		 *
		 * The chip is the value and the photograph is the check, so a variation
		 * with a chip and no photograph is a colour we CAN measure. The first
		 * version of this query drove off the photograph meta and dropped those
		 * on the floor, silently: the Worker returns '' for a picture URL whose
		 * shape it does not recognise (`proxyImage()`), and that colourway then
		 * had no row at all rather than a chip-only one. The declared
		 * hexadecimal joined a third time for the same reason: a colourway with
		 * a number and no picture at all is a colour we CAN measure, and it is
		 * the only thing the supplier ships for 20 % of the catalogue.
		 */
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT c.meta_value AS slug,
				        COALESCE(h.meta_value, '') AS hex,
				        COALESCE(p.meta_value, '') AS photo,
				        COALESCE(k.meta_value, '') AS chip
				 FROM {$wpdb->postmeta} c
				 LEFT JOIN {$wpdb->postmeta} h
				        ON h.post_id = c.post_id AND h.meta_key = %s
				 LEFT JOIN {$wpdb->postmeta} p
				        ON p.post_id = c.post_id AND p.meta_key = %s
				 LEFT JOIN {$wpdb->postmeta} k
				        ON k.post_id = c.post_id AND k.meta_key = %s
				 WHERE c.meta_key = %s AND c.meta_value <> ''
				   AND ( COALESCE(h.meta_value, '') <> ''
				      OR COALESCE(p.meta_value, '') <> ''
				      OR COALESCE(k.meta_value, '') <> '' )
				 GROUP BY c.meta_value, h.meta_value, p.meta_value, k.meta_value
				 ORDER BY c.meta_value ASC, h.meta_value ASC, k.meta_value ASC, p.meta_value ASC",
				Catalogue::META_COLOUR_HEX,
				Catalogue::META_COLOUR_PHOTO,
				Catalogue::META_COLOUR_CHIP,
				'attribute_pa_couleur'
			),
			ARRAY_A
		);

		$cap = max( 1, $per_colour );
		$out = array();
		foreach ( (array) $rows as $row ) {
			$slug = (string) $row['slug'];
			if ( ! isset( $out[ $slug ] ) ) {
				$out[ $slug ] = array(
					'hex'    => array(),
					'chips'  => array(),
					'photos' => array(),
				);
			}
			/*
			 * THE DECLARATIONS ARE NOT CAPPED, and the images are.
			 *
			 * `$cap` exists because every extra image is a fetch. A declaration
			 * costs one string comparison, and truncating the list would make
			 * `Swatch::declared()`'s agreement test depend on an arbitrary
			 * limit: « BLACK » carries six hexadecimals across brands, and
			 * whether a majority of six agrees must not be decided by which five
			 * of them the database returned first.
			 */
			$hex = (string) $row['hex'];
			if ( '' !== $hex && ! in_array( $hex, $out[ $slug ]['hex'], true ) ) {
				$out[ $slug ]['hex'][] = $hex;
			}
			$chip = (string) $row['chip'];
			if ( '' !== $chip && count( $out[ $slug ]['chips'] ) < $cap && ! in_array( $chip, $out[ $slug ]['chips'], true ) ) {
				$out[ $slug ]['chips'][] = $chip;
			}
			$photo = (string) $row['photo'];
			if ( '' !== $photo && count( $out[ $slug ]['photos'] ) < $cap ) {
				$out[ $slug ]['photos'][] = $photo;
			}
		}
		return $out;
	}

	/**
	 * Fetch one photograph and measure it.
	 *
	 * The fetch is `Importer::attachment()`'s, for the reason written there:
	 * `wp_safe_remote_get` refuses a private address and the mirror's Worker is
	 * one, so every photograph would be refused. The host is the shop's own
	 * configured Worker and the path is one this plugin wrote.
	 *
	 * @return array the `Swatch::measure()` shape, refused when anything failed.
	 */
	public static function measure_chip( string $path ): array {
		return self::fetch_and_measure( $path, true );
	}

	/** @return array the `Swatch::measure()` shape, refused when anything failed. */
	public static function measure_photo( string $path ): array {
		return self::fetch_and_measure( $path, false );
	}

	private static function fetch_and_measure( string $path, bool $is_chip ): array {
		/*
		 * `Importer::fetchable()`, ET SURTOUT PAS `Shelf::photo_url()`.
		 *
		 * TÉLÉCHARGER ET AFFICHER SONT DEUX QUESTIONS. `Shelf::photo_url()`
		 * répond à la seconde, et depuis le 9 septembre 2026 elle refuse tout
		 * ce qui n'est pas un chemin `/media/` du Worker, parce qu'une URL
		 * fournisseur dans un attribut `src` publie chez qui nous achetons.
		 * Ce refus est juste et il reste. Il n'a rien à faire ici : ce qui part
		 * d'ici est une requête SERVEUR, une fois, dont le résultat est un
		 * nombre et jamais une adresse rendue au navigateur.
		 *
		 * Mesuré : tant que cette fonction passait par l'affichage, les 84
		 * coloris du nouveau fournisseur donnaient « adresse de photo refusée »
		 * sur 100 % de leurs photographies, donc aucune couleur mesurable, donc
		 * `wp teeshoop gamme appliquer` posait 9 références sur 449.
		 *
		 * `Importer::fetchable()` porte la liste blanche d'hôtes (comparaison
		 * d'hôte complète, jamais un préfixe) et laisse encore passer les
		 * chemins relatifs du Worker, qui sont ce que porte tout ce qui a été
		 * importé avant cette date.
		 */
		$url = Importer::fetchable( $path );
		if ( '' === $url ) {
			/*
			 * UN REFUS DE CONFIGURATION N'EST PAS UN VERDICT SUR LA COULEUR
			 * (IMG-03). Sans `reachable`, le balayage lisait ce refus comme une
			 * photo regardée et sans couleur : `store()` effaçait la pastille
			 * mesurée, et le coloris n'était plus jamais re-mesuré, même une
			 * fois TEESHOOP_SUPPLY_MEDIA_BASE réglée. « Je n'ai pas pu
			 * regarder » ne s'écrit pas.
			 */
			return self::unread( 'adresse de photo refusée' );
		}

		$response = wp_remote_get(
			$url,
			array(
				'timeout' => 60,
				'headers' => array( 'accept' => 'image/*' ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return self::unread( 'photo non récupérée' );
		}
		if ( 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			return self::unread( 'photo non récupérée' );
		}
		$body = (string) wp_remote_retrieve_body( $response );

		/*
		 * The bytes have to BE an image. The Worker answers an SPA fallback in
		 * HTML for an unknown path, and `imagecreatefromstring` on HTML is a
		 * warning and a false, which would read as « image illisible » and hide
		 * a routing mistake behind a measurement failure.
		 */
		if ( "\xFF\xD8\xFF" !== substr( $body, 0, 3 )
			&& "\x89PNG" !== substr( $body, 0, 4 )
			&& 'RIFF' !== substr( $body, 0, 4 ) ) {
			return self::unread( 'la réponse n’est pas une image' );
		}

		return self::measure_bytes( $body, $is_chip );
	}

	/**
	 * Decode bytes and measure them.
	 *
	 * The only place GD is used. Kept separate from the fetch so a test can
	 * hand it a file it built itself.
	 */
	public static function measure_bytes( string $bytes, bool $is_chip = false ): array {
		if ( ! function_exists( 'imagecreatefromstring' ) ) {
			// GD absent is not a colour that could not be measured, it is a
			// shop that cannot measure. Saying so plainly beats 442 identical
			// « image illisible » lines.
			return self::unread( 'GD n’est pas installé sur ce serveur' );
		}

		$im = @imagecreatefromstring( $bytes ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- a corrupt file is an expected answer here, not an exception.
		if ( ! $im ) {
			return self::unread( 'image illisible' );
		}

		$full_w = imagesx( $im );
		$full_h = imagesy( $im );
		if ( $full_w < 8 || $full_h < 8 ) {
			imagedestroy( $im );
			return self::unread( 'image illisible' );
		}

		/*
		 * A CHIP IS NOT REDUCED. It is 168 x 126 to begin with, which is 21 000
		 * pixels of one colour: there is nothing to gain and a bilinear
		 * reduction would invent intermediate colours along its edges, which is
		 * exactly what the flatness check looks at.
		 */
		$w  = $is_chip ? min( $full_w, Swatch::WORK_W ) : Swatch::WORK_W;
		$h  = max( 8, (int) round( $full_h * $w / $full_w ) );
		$sm = $w === $full_w ? $im : imagescale( $im, $w, $h, IMG_BILINEAR_FIXED );
		if ( $sm !== $im ) {
			imagedestroy( $im );
		}
		if ( ! $sm ) {
			return self::unread( 'image illisible' );
		}

		// A palette image answers an index rather than a colour from
		// imagecolorat, and every measurement would then be of the palette's
		// row numbers. GIF and some PNG are palette images.
		if ( ! imageistruecolor( $sm ) ) {
			imagepalettetotruecolor( $sm );
		}

		$w      = imagesx( $sm );
		$h      = imagesy( $sm );
		$pixels = array();
		for ( $y = 0; $y < $h; $y++ ) {
			for ( $x = 0; $x < $w; $x++ ) {
				$pixels[] = imagecolorat( $sm, $x, $y ) & 0xFFFFFF;
			}
		}
		imagedestroy( $sm );

		return $is_chip ? Swatch::chip( $pixels, $w, $h ) : Swatch::measure( $pixels, $w, $h );
	}

	/**
	 * A photograph we could not look at, which is not a colour we refused.
	 *
	 * `reachable` is the whole point of this function existing separately from
	 * `Swatch`'s own refusal. Without it the two are the same array, and a
	 * Worker outage is stored as a verdict: every colour in the catalogue gets
	 * « photo non récupérée » written on it, and the next sweep, which skips
	 * anything already answered, never looks at any of them again.
	 */
	private static function unread( string $why ): array {
		return array(
			'ok'        => false,
			'why'       => $why,
			'reachable' => false,
			'stops'     => array(),
			'share'     => 0.0,
			'scatter'   => 0.0,
		);
	}

	/**
	 * Write one colour's verdict onto its term.
	 *
	 * A COLOUR AND A REASON IT HAS NONE ARE MUTUALLY EXCLUSIVE. Both keys are
	 * deleted before either is written, so a term that was measured last month
	 * and is refused today loses its swatch instead of keeping a stale one
	 * beside a fresh refusal.
	 */
	public static function store( int $term_id, array $verdict ): void {
		$write = array();

		/*
		 * THE MEASUREMENT IS KEPT EVEN WHEN IT IS NOT PUBLISHED.
		 *
		 * A refusal with no numbers behind it cannot be audited: « la photo dit
		 * brun, le nom dit vert » is useless to whoever has to decide whether
		 * the photograph is wrong or the boundary is. Six refusals of that shape
		 * are either six bad photographs or one boundary half a degree out, and
		 * only the OKLCh says which. It never becomes a swatch, because
		 * META_STOPS is what the filter reads and that stays empty.
		 *
		 * EVERY stop, not just the first. A two-tone colourway that is checked
		 * against its own name needs both halves, and so does `reclassify()`.
		 */
		$labs = array();
		if ( ! empty( $verdict['labs'] ) ) {
			$labs = (array) $verdict['labs'];
		} elseif ( ! empty( $verdict['lab'] ) ) {
			$labs = array( $verdict['lab'] );
		}
		if ( ! empty( $labs ) ) {
			$write[ self::META_LAB ] = implode( ';', array_map( array( self::class, 'lab_text' ), $labs ) );
		}

		if ( (int) ( $verdict['photos'] ?? 0 ) > 0 ) {
			// Provenance, not a swatch: how many images the colour was taken
			// from is worth keeping on a refusal too, so `reclassify()` can put
			// the same number back if a boundary later lets the colour through.
			$write[ self::META_PHOTOS ] = (string) (int) $verdict['photos'];
		}

		if ( ! empty( $verdict['ok'] ) ) {
			$write[ self::META_STOPS ]  = implode( ' ', $verdict['stops'] );
			$write[ self::META_FAMILY ] = (string) $verdict['family'];
			// La valeur par défaut est la pastille parce que c'était la seule
			// source le jour où cette meta a été créée : les termes mesurés
			// avant elle ne portent rien et sont bien des pastilles.
			$write[ self::META_SOURCE ] = (string) ( $verdict['source'] ?? self::SOURCE_PASTILLE );
			if ( isset( $verdict['photo_ecart'] ) ) {
				$write[ self::META_ECART ] = (string) $verdict['photo_ecart'];
			}
		} else {
			$write[ self::META_WHY ] = (string) $verdict['why'];
		}

		if ( isset( $verdict['spread'] ) ) {
			$write[ self::META_SPREAD ] = (string) round( (float) $verdict['spread'], 5 );
		}
		$write[ self::META_AT ] = gmdate( 'c' );

		/*
		 * A COLOUR AND A REASON IT HAS NONE ARE MUTUALLY EXCLUSIVE, and only the
		 * keys that are NOT about to be written are cleared. Deleting all of
		 * them first left a window, however short, in which a page rendering
		 * between the two loops saw a colour with neither swatch nor reason.
		 */
		foreach ( self::META_VERDICT as $key ) {
			if ( ! array_key_exists( $key, $write ) ) {
				delete_term_meta( $term_id, $key );
			}
		}
		foreach ( $write as $key => $value ) {
			update_term_meta( $term_id, $key, $value );
		}

		delete_transient( self::MAP_KEY );
	}

	/** One OKLab triple, at the precision the record and the guard both read. */
	private static function lab_text( array $lab ): string {
		return implode( ',', array_map( static fn( $v ) => number_format( (float) $v, 5, '.', '' ), $lab ) );
	}

	/**
	 * The OKLab triples stored on a term, in stop order.
	 *
	 * @return array<int,array{0:float,1:float,2:float}>
	 */
	public static function labs( int $term_id ): array {
		$raw = (string) get_term_meta( $term_id, self::META_LAB, true );
		$out = array();
		foreach ( array_filter( explode( ';', $raw ) ) as $one ) {
			$parts = array_map( 'floatval', explode( ',', $one ) );
			if ( 3 === count( $parts ) ) {
				$out[] = $parts;
			}
		}
		return $out;
	}

	/**
	 * What one term carries, or null when it has never been measured.
	 *
	 * NULL, an unmeasured term and a refused one are three different answers
	 * and the interface shows three different things: nothing at all, a chip
	 * with no swatch, and a chip with no swatch. The last two look the same to
	 * a buyer on purpose (« we do not know this one ») and different to an
	 * operator, who gets the reason.
	 *
	 * @return array{stops:string[],family:string,photos:int,why:string,at:string}|null
	 */
	public static function read( int $term_id ): ?array {
		$stops = (string) get_term_meta( $term_id, self::META_STOPS, true );
		$why   = (string) get_term_meta( $term_id, self::META_WHY, true );
		$at    = (string) get_term_meta( $term_id, self::META_AT, true );

		if ( '' === $stops && '' === $why && '' === $at ) {
			return null;
		}

		return array(
			'stops'  => '' === $stops ? array() : array_values( array_filter( explode( ' ', $stops ) ) ),
			'family' => (string) get_term_meta( $term_id, self::META_FAMILY, true ),
			'photos' => (int) get_term_meta( $term_id, self::META_PHOTOS, true ),
			'source' => (string) get_term_meta( $term_id, self::META_SOURCE, true ),
			'ecart'  => (string) get_term_meta( $term_id, self::META_ECART, true ),
			'spread' => (string) get_term_meta( $term_id, self::META_SPREAD, true ),
			'labs'   => self::labs( $term_id ),
			'why'    => $why,
			'at'     => $at,
		);
	}

	/**
	 * Prime the term meta cache for a whole facet in one query.
	 *
	 * Without this the colour facet is 442 `get_term_meta` calls and 442 SELECTs
	 * on a page that is meant to answer in under a second. WordPress has the
	 * primitive; it simply has to be called.
	 *
	 * @param int[] $term_ids
	 */
	public static function prime( array $term_ids ): void {
		$ids = array_values( array_unique( array_map( 'intval', $term_ids ) ) );
		if ( ! empty( $ids ) ) {
			update_termmeta_cache( $ids );
		}
	}

	/** The transient holding the family map, so a page does not rebuild it. */
	private const MAP_KEY = 'teeshoop_swatch_families';

	/**
	 * Which colour terms belong to each family.
	 *
	 * One query for the whole catalogue rather than one per family, cached
	 * until the next sweep writes a verdict. `store()` drops the cache, so a
	 * re-measurement is visible on the next page load and there is no window
	 * where the filter selects a colour it no longer shows.
	 *
	 * @return array<string,int[]> family slug => term ids
	 */
	public static function by_family(): array {
		$cached = get_transient( self::MAP_KEY );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		global $wpdb;
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT m.meta_value AS famille, m.term_id AS id
				 FROM {$wpdb->termmeta} m
				 INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_id = m.term_id
				 WHERE m.meta_key = %s AND m.meta_value <> '' AND tt.taxonomy = %s",
				self::META_FAMILY,
				self::TAXONOMY
			),
			ARRAY_A
		);

		$map = array();
		foreach ( (array) $rows as $row ) {
			$map[ (string) $row['famille'] ][] = (int) $row['id'];
		}

		// A day, not for ever: a term deleted in the admin leaves this map
		// pointing at an id that no longer exists, and a tax query on a dead id
		// selects nothing rather than everything, so the failure is a facet
		// that finds no references rather than a listing that ignores it.
		set_transient( self::MAP_KEY, $map, DAY_IN_SECONDS );
		return $map;
	}

	/**
	 * Measure the colours, or some of them.
	 *
	 * @param array{max?:int,photos?:int,again?:bool,seconds?:int,progress?:callable} $options
	 * @return array the counters the CLI prints.
	 */
	public static function sweep( array $options = array() ): array {
		$max      = max( 0, (int) ( $options['max'] ?? 0 ) );
		$per      = max( 1, (int) ( $options['photos'] ?? self::PHOTOS_PER_COLOUR ) );
		$again    = ! empty( $options['again'] );
		$seconds  = max( 0, (int) ( $options['seconds'] ?? 0 ) );
		$progress = $options['progress'] ?? null;
		$started  = microtime( true );

		$work  = self::work_list( $per );
		$stats = array(
			'colours'         => 0,
			'measured'        => 0,
			'refused'         => 0,
			'skipped'         => 0,
			'injoignable'     => 0,
			'images'          => 0,
			'declaree'        => 0,
			'fallback'        => 0,
			'photo_verifiee'  => 0,
			'photo_illisible' => 0,
			'photo_loin'      => 0,
			'photo_raisons'   => array(),
			'reasons'         => array(),
			'families'        => array(),
			'stopped'         => '',
		);

		foreach ( $work as $slug => $row ) {
			if ( $seconds > 0 && microtime( true ) - $started > $seconds ) {
				$stats['stopped'] = 'durée';
				break;
			}
			if ( $max > 0 && $stats['colours'] >= $max ) {
				$stats['stopped'] = 'max';
				break;
			}

			$term = get_term_by( 'slug', $slug, self::TAXONOMY );
			if ( ! $term instanceof \WP_Term ) {
				continue;
			}
			if ( ! $again && null !== self::read( (int) $term->term_id ) ) {
				++$stats['skipped'];
				continue;
			}

			/*
			 * ─── LES TROIS SOURCES, DANS L'ORDRE, ET LA PREMIÈRE QUI RÉPOND ───
			 *
			 * La teinte déclarée d'abord (aucune erreur de mesure), la pastille
			 * ensuite (un aplat compressé), la photographie en dernier (un
			 * vêtement éclairé qu'il faut détourer).
			 *
			 * QUI DONNE LE MOTIF QUAND AUCUNE NE RÉPOND : la PREMIÈRE qui a
			 * réellement été essayée. C'est la règle qui existait déjà entre
			 * pastille et photographie et elle se lit bien : un coloris qui a
			 * une pastille illisible et pas de photo doit envoyer l'opérateur
			 * vers la pastille, pas vers une photo qui n'existe pas.
			 */
			$verdict = null;
			$source  = '';

			if ( ! empty( $row['hex'] ) ) {
				$verdict = Swatch::declared( $row['hex'] );
				$source  = self::SOURCE_DECLAREE;
			}

			if ( ( null === $verdict || empty( $verdict['ok'] ) ) && ! empty( $row['chips'] ) ) {
				$chips = array();
				foreach ( $row['chips'] as $path ) {
					$chips[] = self::measure_chip( $path );
					++$stats['images'];
				}
				$measured = Swatch::aggregate( $chips );
				if ( ! empty( $measured['ok'] ) || null === $verdict ) {
					$verdict = $measured;
					$source  = self::SOURCE_PASTILLE;
				}
			}

			if ( ( null === $verdict || empty( $verdict['ok'] ) ) && ! empty( $row['photos'] ) ) {
				$photos = array();
				foreach ( $row['photos'] as $path ) {
					$photos[] = self::measure_photo( $path );
					++$stats['images'];
				}
				$fallback = Swatch::aggregate( $photos );
				if ( ! empty( $fallback['ok'] ) ) {
					$verdict = $fallback;
					$source  = self::SOURCE_PHOTO;
				} elseif ( null === $verdict ) {
					/*
					 * NOTHING EARLIER EXISTED, so an earlier verdict's « aucune
					 * photo » would describe nothing that was tried and send
					 * whoever reads it to look for a missing chip. The
					 * photographs WERE tried; their reason is the one an
					 * operator can act on.
					 */
					$verdict = $fallback;
					$source  = self::SOURCE_PHOTO;
				}
			}

			if ( null === $verdict ) {
				/*
				 * `work_list()` only returns a row carrying at least one of the
				 * three, so this cannot happen from it. Written anyway, and as a
				 * STORED refusal rather than a `continue`, because the failure
				 * that would produce it is a query that stopped filtering, and
				 * that must be visible on the record instead of silently
				 * shrinking the sweep.
				 */
				$verdict = array(
					'ok'    => false,
					'why'   => 'aucune teinte ni photographie pour ce coloris',
					'stops' => array(),
				);
			} elseif ( self::SOURCE_PASTILLE === $source && ! empty( $verdict['ok'] ) && ! empty( $row['photos'] ) ) {
				/*
				 * ONE photograph, as a check and not as a value. The supplier is
				 * known to reuse one colourway's shot for another, and a garment
				 * that does not match its own chip is what that looks like from
				 * here. Recorded for the operator; it never refuses the swatch,
				 * because the swatch is the half that is right.
				 */
				$check = self::measure_photo( (string) $row['photos'][0] );
				++$stats['images'];
				if ( empty( $check['ok'] ) ) {
					/*
					 * A CHECK THAT COULD NOT RUN IS NOT A CHECK THAT PASSED.
					 *
					 * There was a counter for « the photograph disagrees » and
					 * none for « the photograph could not be read », so the two
					 * were indistinguishable in the report and « 44 far from
					 * their chip » could have meant anything from 44 out of 44
					 * to 44 out of 400. MEASURED once it was counted: 396 of the
					 * 397 checks produce a number and one photograph is not a
					 * cut-out. The number was fine; not being able to say so was
					 * not.
					 */
					++$stats['photo_illisible'];
					$reason                            = (string) ( $check['why'] ?? 'photo illisible' );
					$stats['photo_raisons'][ $reason ] = ( $stats['photo_raisons'][ $reason ] ?? 0 ) + 1;
				} else {
					++$stats['photo_verifiee'];
					/*
					 * AGAINST THE NEAREST STOP, not the first one. On a two-tone
					 * colourway the chip is split half and half while the
					 * photograph is a garment, so which of the two comes out
					 * larger is a matter of how much sleeve is in frame.
					 * « Azure/Black » compared first-to-first reads 0,219 apart
					 * and is two photographs of the same garment.
					 */
					$gap = INF;
					foreach ( (array) ( $verdict['labs'] ?? array( $verdict['lab'] ) ) as $stop ) {
						$gap = min( $gap, Swatch::delta( $stop, $check['stops'][0] ) );
					}
					$verdict['photo_ecart'] = round( $gap, 4 );
					if ( $gap > self::PHOTO_MAX ) {
						++$stats['photo_loin'];
					}
				}
			}

			$verdict['source'] = $source;
			$verdict           = Swatch::verify( $verdict, (string) $term->name );

			/*
			 * AN OUTAGE IS NOT A VERDICT, AND IT MUST NOT BE WRITTEN AS ONE.
			 *
			 * `store()` deletes the swatch before writing the reason, so storing
			 * « photo non récupérée » on a Worker outage would strip a colour
			 * that was measured last week. With `--recommencer` that is the
			 * whole catalogue, in one command, from a network failure. Leave the
			 * term exactly as it is and say how many were skipped this way.
			 */
			if ( empty( $verdict['ok'] ) && false === ( $verdict['reachable'] ?? true ) ) {
				++$stats['injoignable'];
				if ( is_callable( $progress ) ) {
					/*
					 * `stored` DIT AU JOURNAL CE QUI S'EST PASSÉ, et il manquait.
					 * Ces 403 lignes s'impriment « refusé : photo non
					 * récupérée » alors que rien n'a été refusé et que rien n'a
					 * été écrit : le terme est laissé exactement tel quel. Le
					 * résumé le dit déjà en fin de commande ; la ligne par
					 * coloris disait le contraire.
					 */
					$progress( $term, array_merge( $verdict, array( 'stored' => false ) ), $stats );
				}
				continue;
			}

			self::store( (int) $term->term_id, $verdict );

			++$stats['colours'];
			if ( ! empty( $verdict['ok'] ) ) {
				++$stats['measured'];
				/*
				 * COMPTÉ ICI ET PAS À LA SOURCE, POUR QUE LA LIGNE S'ADDITIONNE.
				 *
				 * Ces deux compteurs étaient incrémentés au moment où la source
				 * répondait, donc avant `Swatch::verify()`, qui peut encore
				 * refuser. Relevé sur le miroir : « 19 mesurés dont 2 sur teinte
				 * déclarée et 18 repliés sur la photo », soit vingt sur
				 * dix-neuf. Un rapport dont les nombres ne s'additionnent pas ne
				 * se lit pas, il se devine.
				 */
				if ( self::SOURCE_DECLAREE === $source ) {
					++$stats['declaree'];
				} elseif ( self::SOURCE_PHOTO === $source ) {
					++$stats['fallback'];
				}
				$family                        = (string) $verdict['family'];
				$stats['families'][ $family ]  = ( $stats['families'][ $family ] ?? 0 ) + 1;
			} else {
				++$stats['refused'];
				$why                     = (string) $verdict['why'];
				$stats['reasons'][ $why ] = ( $stats['reasons'][ $why ] ?? 0 ) + 1;
			}

			if ( is_callable( $progress ) ) {
				$progress( $term, array_merge( $verdict, array( 'stored' => true ) ), $stats );
			}
		}

		$stats['total'] = count( $work );
		arsort( $stats['reasons'] );
		return $stats;
	}

	/**
	 * Re-decide every family from the colours already measured, with no fetch.
	 *
	 * A family is a pure function of the OKLab triples on the term, and those
	 * are stored. Until this existed, moving a boundary in `Swatch` meant
	 * `couleurs mesurer --recommencer`, which fetches about 1 900 supplier
	 * images and takes seventeen minutes, so in practice a boundary moved and
	 * the shop went on serving the families it computed last week. This is the
	 * same decision over the same numbers, in a second.
	 *
	 * IT NEVER INVENTS A COLOUR IT DID NOT MEASURE. A term with no stored triple
	 * is left exactly as it is and counted, because the triple is the only thing
	 * that came from an image.
	 *
	 * @return array{colours:int,changés:int,publiés:int,refusés:int,sans_mesure:int,mouvements:array<string,int>}
	 */
	public static function reclassify(): array {
		$stats = array(
			'colours'     => 0,
			'changés'     => 0,
			'publiés'     => 0,
			'refusés'     => 0,
			'sans_mesure' => 0,
			'incomplet'   => 0,
			'mouvements'  => array(),
		);

		$terms = get_terms(
			array(
				'taxonomy'   => self::TAXONOMY,
				'hide_empty' => false,
			)
		);
		if ( ! is_array( $terms ) ) {
			return $stats;
		}
		self::prime( array_map( static fn( $t ) => (int) $t->term_id, $terms ) );

		foreach ( $terms as $term ) {
			$read = self::read( (int) $term->term_id );
			if ( null === $read || empty( $read['labs'] ) ) {
				++$stats['sans_mesure'];
				continue;
			}

			$labs = $read['labs'];

			/*
			 * FEWER TRIPLES THAN STOPS MEANS THIS TERM CANNOT ANSWER.
			 *
			 * Before this session only the primary stop's OKLab was kept, so a
			 * two-tone colour reads back as one. `Swatch::verify()` would then
			 * find that « Black/White » shows one family while its name names
			 * two, and refuse a measurement that was right: 34 colours lost
			 * their swatch on the first run of this command, from missing data
			 * rather than from a decision. Not looking is not refusing.
			 */
			if ( count( $labs ) < count( $read['stops'] ) ) {
				++$stats['incomplet'];
				continue;
			}

			$before = '' !== $read['family'] ? $read['family'] : 'refusé';

			$agg = array(
				'ok'     => true,
				'why'    => '',
				'stops'  => empty( $read['stops'] ) ? array_map( array( Swatch::class, 'hex' ), $labs ) : $read['stops'],
				'lab'    => $labs[0],
				'labs'   => $labs,
				'family' => Swatch::family( $labs[0] ),
				'photos' => (int) $read['photos'],
				'seen'   => (int) $read['photos'],
				'spread' => (float) $read['spread'],
				'source' => '' === $read['source'] ? self::SOURCE_PASTILLE : $read['source'],
			);
			if ( '' !== $read['ecart'] ) {
				$agg['photo_ecart'] = (float) $read['ecart'];
			}

			$verdict = Swatch::verify( $agg, (string) $term->name );
			$after   = empty( $verdict['ok'] ) ? 'refusé' : (string) $verdict['family'];

			++$stats['colours'];
			if ( empty( $verdict['ok'] ) ) {
				++$stats['refusés'];
			} else {
				++$stats['publiés'];
			}
			if ( $after !== $before ) {
				++$stats['changés'];
				$move                          = $before . ' -> ' . $after;
				$stats['mouvements'][ $move ]  = ( $stats['mouvements'][ $move ] ?? 0 ) + 1;
			}

			self::store( (int) $term->term_id, $verdict );
		}

		arsort( $stats['mouvements'] );
		return $stats;
	}

	/**
	 * How many published references carry each colour, counted now.
	 *
	 * NOT `wp_term_taxonomy.count`. WooCommerce defers product sync during the
	 * import and never recounts attribute terms afterwards: MEASURED on the
	 * mirror, 25 of 442 colour terms carry a non-zero stored count while 383 are
	 * really in use. The theme's facet was changed in this same session to stop
	 * reading that column, and the record had gone on quoting it.
	 *
	 * @return array<int,int> term id => references
	 */
	public static function article_counts(): array {
		global $wpdb;

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT tt.term_id AS id, COUNT(DISTINCT tr.object_id) AS n
				 FROM {$wpdb->term_taxonomy} tt
				 INNER JOIN {$wpdb->term_relationships} tr ON tr.term_taxonomy_id = tt.term_taxonomy_id
				 INNER JOIN {$wpdb->posts} p ON p.ID = tr.object_id
				 WHERE tt.taxonomy = %s AND p.post_type = 'product' AND p.post_status = 'publish'
				 GROUP BY tt.term_id",
				self::TAXONOMY
			),
			ARRAY_A
		);

		$out = array();
		foreach ( (array) $rows as $row ) {
			$out[ (int) $row['id'] ] = (int) $row['n'];
		}
		return $out;
	}

	/**
	 * The reviewable record of what was measured.
	 *
	 * NO SUPPLIER REFERENCE MAY APPEAR IN IT. This file is committed, so it is
	 * public the moment the repository is, and the photograph paths that fed
	 * the measurement carry the supplier's style numbers. The colour NAMES are
	 * already on every product page, so they are not a leak; the paths are.
	 * `scripts/couleurs-guard.mjs` asserts the difference rather than trusting
	 * this comment.
	 *
	 * @return array
	 */
	public static function ledger(): array {
		$terms = get_terms(
			array(
				'taxonomy'   => self::TAXONOMY,
				'hide_empty' => false,
			)
		);
		if ( ! is_array( $terms ) ) {
			return array();
		}

		self::prime( array_map( static fn( $t ) => (int) $t->term_id, $terms ) );

		$rows  = array();
		$stats = array(
			'mesurés'  => 0,
			'refusés'  => 0,
			'inconnus' => 0,
		);
		$sources = array();
		$counts  = self::article_counts();

		foreach ( $terms as $term ) {
			$row = array(
				'nom'      => (string) $term->name,
				'slug'     => (string) $term->slug,
				'articles' => (int) ( $counts[ (int) $term->term_id ] ?? 0 ),
			);

			$read = self::read( (int) $term->term_id );
			if ( null === $read ) {
				/*
				 * A COLOUR NOBODY HAS LOOKED AT IS STILL A ROW.
				 *
				 * It used to be counted in `inconnus` and dropped, so a sweep
				 * stopped by `--max` or `--durée` produced a record of twenty
				 * colours, all measured, and every check over it passed.
				 * Three states, three shapes, all of them present.
				 */
				++$stats['inconnus'];
				$row['jamais_mesuré'] = true;
				$rows[]               = $row;
				continue;
			}

			$labs = $read['labs'];
			$row['nom_dit'] = Swatch::name_family( (string) $term->name );

			if ( ! empty( $read['stops'] ) ) {
				++$stats['mesurés'];
				$row['pastille'] = $read['stops'];
				$row['famille']  = $read['family'];
				$row['source']   = '' === $read['source'] ? self::SOURCE_PASTILLE : $read['source'];
				/*
				 * DEUX NOMS PARCE QUE CE SONT DEUX CHOSES.
				 *
				 * `META_PHOTOS` compte ce sur quoi la médiane a été prise : des
				 * images sur les deux chemins photographiques, des déclarations
				 * du fabricant sur le troisième, où rien n'a été téléchargé.
				 * Écrire « images: 6 » sur un coloris mesuré sans image ferait
				 * dire au relevé le contraire de ce qui s'est passé, et
				 * `couleurs etat` compte les coloris tenant sur une SEULE photo,
				 * ce qu'une teinte déclarée n'est jamais.
				 */
				if ( self::SOURCE_DECLAREE === $row['source'] ) {
					$row['declarations'] = $read['photos'];
				} else {
					$row['images'] = $read['photos'];
				}
				if ( '' !== $read['ecart'] ) {
					$row['ecart_photo'] = (float) $read['ecart'];
				}
			} else {
				++$stats['refusés'];
				$row['refus'] = $read['why'];
				if ( ! empty( $labs ) ) {
					$row['vue'] = Swatch::family( $labs[0] );
				}
			}

			if ( '' !== $read['spread'] ) {
				$row['ecart_images'] = (float) $read['spread'];
			}

			/*
			 * TWO FORMS OF THE SAME MEASUREMENT, AND ONLY ONE OF THEM DECIDES.
			 *
			 * `lab` is exactly what was stored and exactly what the code
			 * classified: the guard re-runs `Swatch` on it and gets the same
			 * answer by construction. `oklch` is for a person reading the file,
			 * rounded to what a person can use.
			 *
			 * They were not both here at first, and the guard read the rounded
			 * one. « Lime » measures h=114,972 and « Acid Lime » h=114,989; both
			 * print as 115,0, which is the far side of a boundary, so the guard
			 * reported two colours as disagreeing with code that had not
			 * changed. A gate that cries wolf is spent the first time it is
			 * right.
			 */
			if ( ! empty( $labs ) ) {
				$row['lab'] = array_map(
					static fn( array $lab ): array => array_map( static fn( $v ) => round( (float) $v, 5 ), $lab ),
					$labs
				);
				list( $capital_l, $c, $h ) = Swatch::oklch( $labs[0] );
				$row['oklch']              = array( round( $capital_l, 4 ), round( $c, 4 ), round( $h, 1 ) );
				$row['saturation']         = round( Swatch::saturation( $capital_l, $c ), 4 );
			}

			$rows[] = $row;
		}

		usort(
			$rows,
			static function ( array $a, array $b ): int {
				return array( $a['famille'] ?? 'zz', $a['nom'] ) <=> array( $b['famille'] ?? 'zz', $b['nom'] );
			}
		);

		foreach ( $rows as $row ) {
			if ( isset( $row['source'] ) ) {
				$sources[ $row['source'] ] = ( $sources[ $row['source'] ] ?? 0 ) + 1;
			}
		}

		return array(
			'mesuré_le' => gmdate( 'Y-m-d' ),
			'méthode'   => 'teinte hexadécimale déclarée par le fabricant ; à défaut médiane OKLab de sa pastille ; à défaut du vêtement photographié, fond retiré par remplissage connecté depuis le bord',
			'largeur'   => Swatch::WORK_W,
			// Exported rather than written down twice: the guard prints how many
			// photographs are far from their chip and must use the threshold the
			// sweep applied, not a copy of it that can be left behind.
			'ecart_max' => self::PHOTO_MAX,
			'familles'  => Swatch::families(),
			'compte'    => $stats,
			'sources'   => $sources,
			'couleurs'  => $rows,
		);
	}

	/** Forget every measurement. Used by `--recommencer` and by the tests. */
	public static function forget(): int {
		$terms = get_terms(
			array(
				'taxonomy'   => self::TAXONOMY,
				'hide_empty' => false,
				'fields'     => 'ids',
			)
		);
		if ( ! is_array( $terms ) ) {
			return 0;
		}
		$n = 0;
		foreach ( $terms as $id ) {
			if ( null === self::read( (int) $id ) ) {
				continue;
			}
			/*
			 * `META_VERDICT` ET NON UNE COPIE DE LA LISTE.
			 *
			 * La copie qui était écrite ici avait été oubliée le jour où
			 * `META_SPREAD` a été ajoutée : un coloris oublié gardait son écart
			 * entre images, seul reste d'une mesure que la commande dit avoir
			 * effacée. La liste existe une fois, à un seul endroit.
			 */
			foreach ( self::META_VERDICT as $key ) {
				delete_term_meta( (int) $id, $key );
			}
			++$n;
		}
		delete_transient( self::MAP_KEY );
		return $n;
	}
}
