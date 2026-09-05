<?php
/**
 * LE GARDE DU PLANCHER : aucune colonne publiée ne se vend sous son coût.
 *
 * ── POURQUOI CE FICHIER EXISTE ───────────────────────────────────────────────
 *
 * Le 2 septembre 2026, `tests/demo-grille.php` a mesuré que la grille publique
 * vendait cinquante pièces **1,81 EUR sous leur plancher** et cinq pièces
 * **3,69 EUR sous le leur**. Cinquante pièces est exactement la quantité que
 * l'accueil met en avant.
 *
 * Ce n'était pas une erreur de calcul : `Pricing::quote()` était juste, et
 * `Costing::compute()` aussi. Le défaut est qu'aucun des deux ne parlait à
 * l'autre. `Pricing` est PUR (aucune fonction WordPress, par construction) et ne
 * connaît pas un coût ; `Costing` connaît le coût et a besoin d'une commande
 * réelle. Entre les deux il n'y avait rien, donc la grille pouvait dériver sous
 * son plancher sans qu'aucun contrôle ne bouge. Le prix du textile nu change à
 * chaque grille fournisseur, le film à chaque tarif, le port à chaque tranche
 * Colissimo : cette dérive n'est pas un accident, c'est le régime normal.
 *
 * Ceci est le contrôle qui manquait. Il fait tourner LES DEUX moteurs réels, sur
 * de vraies commandes, sur les vraies références de la gamme, à chaque quantité
 * que la boutique publie, et il refuse.
 *
 * ── CE QU'IL MESURE, ET POURQUOI À CETTE SURFACE-LÀ ──────────────────────────
 *
 * La grille annonce un prix « jusqu'à N cm² par face », N étant la borne du
 * premier palier de surface, que `Pricing::std_area_sq_cm()` rend et que ce
 * fichier ne recopie pas. Un client peut commander exactement cette surface. Le plancher doit donc tenir
 * À LA BORNE, pas à une surface confortable choisie par le contrôle : un garde
 * qui mesure 288 cm² valide un prix que la page promet pour 625.
 *
 * La pièce est un carré unique à la borne. C'est la forme canonique que la
 * grille décrit (un visuel, une face). Une création de même surface découpée en
 * plusieurs morceaux coûte davantage en pose et s'imbrique différemment dans le
 * film : cette question-là est ouverte et nommée dans le rapport, elle n'est pas
 * couverte ici.
 *
 * ── CE QU'IL REFUSE ──────────────────────────────────────────────────────────
 *
 *   1. Une colonne publiée dont l'encaissé HT est sous le plancher du moteur.
 *   2. Une colonne dont le plancher n'est pas calculable : « on n'a pas pu
 *      regarder » n'est pas « tout va bien ».
 *   3. Une exécution qui n'a mesuré aucune ligne. Un garde qui ne scanne rien
 *      sort en erreur, il ne sort pas vert.
 *
 * Il ne refuse PAS sur le prix conseillé. Le plancher est le seuil de sécurité ;
 * le conseillé est le tarif qu'on a choisi de publier, et l'écart des deux est
 * imprimé sur chaque ligne pour qu'il soit visible sans être un blocage.
 *
 * ── OÙ IL TOURNE ─────────────────────────────────────────────────────────────
 *
 *   npm run verify:grille
 *
 * Pas dans `npm run ci` : il lui faut un vrai WordPress, une base et le
 * catalogue importé, exactement comme `npm run test:wp`. Le fichier d'en-tête de
 * `.github/workflows/ci.yml` dit lesquels sont dehors et pourquoi.
 *
 * COMMANDE EN LIGNE UNIQUEMENT : ce répertoire est servi par URL et ce fichier
 * CRÉE DES COMMANDES. Même garde que demo-grille.php et demo-order.php.
 *
 * @package Teeshoop\Core
 */

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Design;
use Teeshoop\Core\Cart;
use Teeshoop\Core\Costing;
use Teeshoop\Core\Gamme;
use Teeshoop\Core\Garments;
use Teeshoop\Core\Money;
use Teeshoop\Core\Pricing;
use Teeshoop\Core\Product;
use Teeshoop\Core\ProductPage;
use Teeshoop\Core\Settings;

if ( ! defined( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS' ) ) {
	define( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS', true );
}

/**
 * Le coloris LE PLUS CHER que cette offre propose, à la taille de tarification.
 *
 * Le client choisit sa couleur, et elle change le prix d'achat : mesuré sur le
 * B&C #E150 en M, 3,00 EUR en blanc contre 3,78 en noir, 26 % d'écart sur le
 * plus gros poste de coût. Un plancher vérifié sur le blanc laisse passer la
 * commande en noir.
 *
 * Rend null quand aucun coloris proposé ne se résout à un article portant un
 * prix d'achat, ce qui est un refus et pas un zéro.
 *
 * @return array{studio:string,term:string,cents:int}|null
 */
function teeshoop_grille_dearest_colour( int $product_id, string $size ): ?array {
	$ref = Product::blank_ref_of( $product_id );
	if ( '' === $ref ) {
		return null;
	}
	$blank_ids = get_posts(
		array(
			'post_type'      => 'product',
			'post_status'    => 'any',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'meta_key'       => '_teeshoop_ref', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- a command, not a page load.
			'meta_value'     => $ref, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- as above.
		)
	);
	if ( array() === $blank_ids ) {
		return null;
	}
	$blank = wc_get_product( (int) $blank_ids[0] );
	if ( ! $blank instanceof \WC_Product ) {
		return null;
	}

	/* term name (lowercased) => the dearest article of that colour at $size. */
	$by_colour = array();
	foreach ( $blank->get_children() as $child ) {
		$variation = wc_get_product( (int) $child );
		if ( ! $variation instanceof \WC_Product_Variation ) {
			continue;
		}
		$attributes = $variation->get_attributes();
		if ( strtolower( (string) ( $attributes['pa_taille'] ?? '' ) ) !== strtolower( $size ) ) {
			continue;
		}
		$cents = $variation->get_meta( '_teeshoop_supply_cents', true );
		if ( ! is_numeric( $cents ) || (int) $cents <= 0 ) {
			continue;
		}
		$term = get_term_by( 'slug', (string) ( $attributes['pa_couleur'] ?? '' ), 'pa_couleur' );
		if ( ! $term instanceof \WP_Term ) {
			continue;
		}
		$key = strtolower( $term->name );
		$by_colour[ $key ] = max( (int) ( $by_colour[ $key ] ?? 0 ), (int) $cents );
	}

	$best = null;
	foreach ( Product::blank_colours_of( $product_id ) as $studio => $term_name ) {
		$cents = $by_colour[ strtolower( $term_name ) ] ?? 0;
		if ( $cents <= 0 ) {
			continue;
		}
		/*
		 * Strictement supérieur, puis départage sur le nom : deux coloris au
		 * même prix d'achat ne doivent pas faire dépendre le résultat de l'ordre
		 * dans lequel la carte a été écrite. Un garde qui change d'avis entre
		 * deux exécutions identiques n'est pas un garde.
		 */
		if ( null === $best || $cents > $best['cents'] || ( $cents === $best['cents'] && strcmp( $term_name, $best['term'] ) < 0 ) ) {
			$best = array(
				'studio' => (string) $studio,
				'term'   => (string) $term_name,
				'cents'  => $cents,
			);
		}
	}
	return $best;
}

/**
 * La taille LA PLUS CHÈRE que cette offre vend, ou '' si aucune ne se résout.
 *
 * Le prix d'achat monte avec la taille et le prix de vente ne bouge pas, donc
 * c'est la taille la plus grande qui décide si le tarif tient. Voir le
 * commentaire au point d'appel.
 */
function teeshoop_grille_sizes_by_cost( int $product_id, string $garment ): array {
	$ref = Product::blank_ref_of( $product_id );
	if ( '' === $ref ) {
		return array();
	}
	$blank_ids = get_posts(
		array(
			'post_type'      => 'product',
			'post_status'    => 'any',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'meta_key'       => '_teeshoop_ref', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- a command, not a page load.
			'meta_value'     => $ref, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- as above.
		)
	);
	if ( array() === $blank_ids ) {
		return array();
	}
	$blank = wc_get_product( (int) $blank_ids[0] );
	if ( ! $blank instanceof \WC_Product ) {
		return array();
	}

	/*
	 * LA TAILLE DOIT ÊTRE UNE QUE LE STUDIO SAIT PRESSER, sinon `Cart::add`
	 * refuse la grille de tailles et le contrôle mesure zéro colonne en croyant
	 * mesurer la plus chère. Le fournisseur en publie que la charte n'a pas.
	 */
	$known = array_map( 'strtolower', ProductPage::size_ids( $garment ) );

	$costs = array();
	foreach ( $blank->get_children() as $child ) {
		$variation = wc_get_product( (int) $child );
		if ( ! $variation instanceof \WC_Product_Variation ) {
			continue;
		}
		$attributes = $variation->get_attributes();
		$size       = strtolower( (string) ( $attributes['pa_taille'] ?? '' ) );
		if ( '' === $size || ! in_array( $size, $known, true ) ) {
			continue;
		}
		$cents = $variation->get_meta( '_teeshoop_supply_cents', true );
		if ( ! is_numeric( $cents ) || (int) $cents <= 0 ) {
			continue;
		}
		$costs[ strtoupper( $size ) ] = (int) $cents;
	}
	/*
	 * Le plus cher d'abord, puis l'ordre alphabétique, pour que deux tailles au
	 * même prix d'achat ne fassent pas dépendre la réponse de l'ordre dans lequel
	 * WooCommerce a rendu les enfants.
	 */
	uksort(
		$costs,
		static function ( string $a, string $b ) use ( $costs ): int {
			return $costs[ $b ] <=> $costs[ $a ] ?: strcmp( $a, $b );
		}
	);
	return array_keys( $costs );
}

/** La plus chère seule, pour les appelants qui n'ont pas de repli à faire. */
function teeshoop_grille_dearest_size( int $product_id, string $garment ): string {
	$sizes = teeshoop_grille_sizes_by_cost( $product_id, $garment );
	return array() === $sizes ? '' : (string) $sizes[0];
}

/**
 * Une création que la boutique acceptera, mintée sur la vraie route du Worker.
 *
 * ── POURQUOI PAS UN IDENTIFIANT INVENTÉ ────────────────────────────────────
 *
 * `Design::verify` échappe deux cas en développement, « aucun Worker configuré »
 * et « Worker injoignable », et PAS « le Worker ne connaît pas cette
 * création » : un 404 refuse, ce qui est le bon comportement pour une boutique.
 * Le harnais utilisait un identifiant fixe, donc son verdict dépendait de ce qui
 * écoutait sur le port du Worker : arrêté, tout passait ; en marche, tout
 * échouait, et le message annonçait un plancher franchi sur des colonnes jamais
 * chiffrées.
 *
 * Alors il en crée une vraie, sur `POST /api/design`, la route ouverte que le
 * studio utilise. Un document sans image est un document valide (un marquage en
 * texte seul), ce qui évite d'inventer une œuvre pour un contrôle de prix.
 *
 * Rend '' quand aucun Worker n'est configuré, ce qui est le cas normal du miroir
 * et où l'échappatoire de développement fait le travail.
 */
function teeshoop_grille_design_id( array $sides ): string {
	static $cache = array();

	$worker = (string) Settings::get( 'worker_url' );
	if ( '' === $worker ) {
		return 'grillegardegrilleg';
	}

	/*
	 * UNE CRÉATION PAR NOMBRE DE FACES, et c'est le manifeste qui l'impose.
	 *
	 * `Cart::add` prend les surfaces imprimées DU MANIFESTE et non de la requête
	 * dès que la création est vérifiée, ce qui est tout l'intérêt du manifeste.
	 * Une seule création à une face donnait donc une ligne à une face quelle que
	 * soit la colonne mesurée, et le coût sortait sans marquage sur les colonnes
	 * à deux et trois faces. Les surfaces sont mises en cache par leur forme,
	 * donc trois appels au Worker pour tout le contrôle.
	 */
	$key = wp_json_encode( $sides );
	if ( isset( $cache[ $key ] ) ) {
		return $cache[ $key ];
	}

	$layers = array();
	foreach ( $sides as $side ) {
		$layers[] = array( 'type' => 'text', 'side' => (string) $side['id'], 'text' => 'GARDE' );
	}
	$doc = wp_json_encode(
		array(
			'garmentId' => 'tee',
			'colorId'   => 'navy',
			'layers'    => $layers,
			'sides'     => $sides,
		)
	);
	// Un PNG 1x1 transparent : l'aperçu est obligatoire, sa taille ne l'est pas.
	$png      = base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' );
	$boundary = 'teeshoopgrille' . wp_generate_password( 16, false );
	$eol      = "\r\n";
	$body     = '--' . $boundary . $eol
		. 'Content-Disposition: form-data; name="design"; filename="design.json"' . $eol
		. 'Content-Type: application/json' . $eol . $eol . $doc . $eol
		. '--' . $boundary . $eol
		. 'Content-Disposition: form-data; name="preview"; filename="preview.png"' . $eol
		. 'Content-Type: image/png' . $eol . $eol . $png . $eol
		. '--' . $boundary . '--' . $eol;

	$response = wp_remote_post(
		rtrim( $worker, '/' ) . '/api/design',
		array(
			'timeout' => 20,
			'headers' => array( 'content-type' => 'multipart/form-data; boundary=' . $boundary ),
			'body'    => $body,
		)
	);
	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		/*
		 * Un Worker configuré mais qui refuse est un état dont ce contrôle ne
		 * peut rien conclure : il le dit et s'arrête, plutôt que de retomber sur
		 * un identifiant que `Design::verify` refusera colonne par colonne.
		 */
		WP_CLI::error(
			'Le Worker de `teeshoop_settings.worker_url` est configuré mais n’a pas accepté la création du contrôle : '
			. ( is_wp_error( $response ) ? $response->get_error_message() : 'code ' . wp_remote_retrieve_response_code( $response ) )
			. '. Rien n’a été mesuré.'
		);
	}
	$parsed = json_decode( (string) wp_remote_retrieve_body( $response ), true );
	$id     = is_array( $parsed ) ? (string) ( $parsed['id'] ?? '' ) : '';
	if ( '' === $id ) {
		WP_CLI::error( 'Le Worker n’a pas rendu d’identifiant de création. Rien n’a été mesuré.' );
	}
	/*
	 * LE MANIFESTE DOIT PORTER AUTANT DE FACES QUE DEMANDÉ, sinon le contrôle
	 * mesure une autre commande que celle qu'il croit. `readDesignDoc` laisse
	 * tomber en silence une pièce trop petite pour l'encre qu'elle annonce, et
	 * une face sans pièce ne coûte pas de film.
	 */
	$manifest = json_decode( (string) wp_remote_retrieve_body( $response ), true );
	if ( count( (array) ( $manifest['sides'] ?? array() ) ) !== count( $sides ) ) {
		WP_CLI::error(
			sprintf(
				'Le Worker a retenu %d face(s) sur les %d demandées : le contrôle mesurerait une autre commande que celle qu’il publie.',
				count( (array) ( $manifest['sides'] ?? array() ) ),
				count( $sides )
			)
		);
	}
	$cache[ $key ] = $id;
	return $id;
}

$config = Settings::pricing();
$qtys   = Pricing::grid_qtys( $config );
$bound  = Pricing::std_area_sq_cm( $config );

if ( null === $bound ) {
	WP_CLI::error( 'Le premier palier de surface n’a pas de borne : la grille ne promet aucune surface et ce contrôle ne sait pas quoi mesurer.' );
}
/*
 * Le côté du carré, arrondi au dixième de centimètre INFÉRIEUR, pour que la
 * surface reste sous la borne et donc dans le palier que la grille facture. Un
 * arrondi supérieur ferait basculer la ligne au palier au-dessus et le contrôle
 * mesurerait un prix que la colonne ne publie pas.
 */
$edge = floor( sqrt( (float) $bound ) * 10 ) / 10;
$area = $edge * $edge;

/*
 * LE CLIENT LE PLUS ORDINAIRE QUI SOIT, parce qu'un plancher doit tenir sur lui.
 * Paris, livraison France métropolitaine, virement : aucun frais de plateforme,
 * aucune commission commerciale, aucune urgence. C'est le panier le moins cher à
 * servir ; s'il passe sous le plancher, tous les autres aussi.
 */
WC()->customer->set_shipping_country( 'FR' );
WC()->customer->set_shipping_postcode( '75011' );
WC()->customer->set_billing_country( 'FR' );
WC()->customer->set_billing_postcode( '75011' );
WC()->customer->save();

/** @var array<int,array<string,mixed>> */
$rows    = array();
$made    = array();
$fails   = array();
$blocked = array();
$skipped = array();
/*
 * Les compromis assumés du garde, imprimés même quand tout est vert : une
 * mesure prise autrement que ce que l'en-tête annonce doit se lire dans la
 * sortie, sinon la sortie promet plus que ce qu'elle a fait.
 */
$notes   = array();
$offers  = 0;

foreach ( Gamme::RANGE as $ref => $garment ) {
	$found = get_posts(
		array(
			'post_type'      => 'product',
			'post_status'    => 'publish',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'meta_key'       => Gamme::META_SOURCE, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- a command, not a page load.
			'meta_value'     => (string) $ref, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- as above.
		)
	);
	if ( array() === $found ) {
		$fails[] = sprintf( 'la référence %s de la gamme n’a aucune offre publiée : lancez « teeshoop gamme appliquer ».', $ref );
		continue;
	}
	$product_id = (int) $found[0];
	$product    = wc_get_product( $product_id );
	if ( ! $product instanceof \WC_Product || ! $product->is_purchasable() ) {
		$fails[] = sprintf( 'l’offre de la référence %s n’est pas achetable.', $ref );
		continue;
	}
	++$offers;

	/*
	 * LA TAILLE LA PLUS CHÈRE, ET C'EST LE MÊME RAISONNEMENT QUE LA COULEUR.
	 *
	 * Le tarif publié est le MÊME à toutes les tailles : `Pricing::quote()` ne
	 * reçoit pas de taille, par construction. Le COÛT, lui, est par taille :
	 * `Purchase::articles_for()` résout un article fournisseur par taille de la
	 * grille et le facture au prix de cet article. Mesuré sur la fiche
	 * fournisseur du dépôt, même coloris : 3,37 EUR en S et en M, 4,95 en 2XL,
	 * soit +47 % sur le plus gros poste de coût.
	 *
	 * Ce contrôle mesurait à `Garments::priced_size()`, c'est-à-dire M, donc à la
	 * bande de tailles la moins chère. Une série entièrement en 2XL pouvait
	 * passer sous son plancher pendant que le garde restait vert : trouvé par la
	 * passe adversariale du 4 septembre 2026, qui a calculé que la marge du sweat
	 * (9,15 EUR sur cinq pièces, soit 1,83 par pièce) est plus petite que le pas
	 * de taille (au moins 2,11 EUR de plancher par pièce).
	 *
	 * Le garde mesure donc la commande la plus chère à servir que la page
	 * publie : la taille la plus chère, dans le coloris le plus cher.
	 */
	/*
	 * ── LA TAILLE LA PLUS CHÈRE, ET LE MARQUAGE RÉTRÉCIT S'IL LE FAUT ───────
	 *
	 * Le plancher est une question d'ARGENT, et ce qui le déplace est le prix
	 * d'achat du textile, qui monte avec la taille. Mesuré sur la gamme : le
	 * blanc passe de 4,28 à 6,06 EUR entre le 2XL et le 3XL sur le Gildan Heavy
	 * Cotton, et de 14,92 à 21,07 sur le Heavy Blend, soit 3,56 et 12,30 EUR de
	 * plancher par pièce puisque le plancher vaut deux fois le coût direct. Une
	 * version de ce garde descendait d'une taille quand le marquage du palier
	 * standard ne tenait plus sur le film une fois gradé ; elle cessait alors de
	 * surveiller la seule colonne sur laquelle le tarif avait été résolu, et
	 * l'annonçait poliment. La passe adversariale du 5 septembre 2026 l'a mesuré :
	 * 29009, une face, vingt-cinq pièces, passait de 10,73 EUR de marge au-dessus
	 * du plancher à 318,23 EUR annoncés, en mesurant un 2XL.
	 *
	 * Or le prix ne dépend PAS de la surface à l'intérieur du palier : un logo de
	 * 15 cm et un carré de 25 cm sont dans la même cellule et au même prix. Un
	 * 3XL avec un marquage un peu plus petit est donc une commande réelle, au
	 * même prix publié, et plus chère à servir. C'est elle qu'il faut mesurer.
	 *
	 * Le garde garde donc la taille et rétrécit le carré jusqu'à ce qu'il tienne,
	 * en restant dans le palier, et il dit de combien.
	 */
	$sizes = teeshoop_grille_sizes_by_cost( $product_id, $garment );
	if ( array() === $sizes ) {
		$fails[] = sprintf( '%s : aucune taille de l’offre ne se résout à un article fournisseur avec un prix d’achat.', $ref );
		continue;
	}
	$size  = (string) $sizes[0];
	$chart = ProductPage::maker_chart( $product_id );

	$probe = static function ( float $side_cm ) use ( $garment, $chart, $size ): bool {
		return array() === Design::unprintable_sizes(
			$garment,
			array(
				array(
					'id'         => 'front',
					'area_sq_cm' => $side_cm * $side_cm,
					'pieces'     => array( array( 'w_cm' => $side_cm, 'h_cm' => $side_cm ) ),
				),
			),
			array( $size => 1 ),
			$chart
		);
	};

	$edge_here = $edge;
	if ( ! $probe( $edge_here ) ) {
		// Un dixième de centimètre à la fois, vers le bas : le marquage reste une
		// commande que la page vend au même prix, et le pas est celui dans lequel
		// `$edge` est déjà exprimé.
		while ( $edge_here > 1.0 && ! $probe( $edge_here ) ) {
			$edge_here = round( $edge_here - 0.1, 1 );
		}
		if ( $edge_here <= 1.0 ) {
			$fails[] = sprintf(
				'%s : aucun marquage, même minuscule, ne peut être imprimé en %s. La taille est vendue et rien n’y tient.',
				$ref,
				$size
			);
			continue;
		}
		$notes[] = sprintf(
			'%s (%s) : mesuré en %s avec un marquage de %s cm de côté au lieu de %s, parce qu’au-delà le transfert gradé dépasse le film. Même palier, même prix publié, même taille la plus chère.',
			$ref,
			$garment,
			$size,
			number_format( $edge_here, 1, ',', ' ' ),
			number_format( (float) $edge, 1, ',', ' ' )
		);
	}
	$area_here = $edge_here * $edge_here;

	/*
	 * LA COULEUR LA PLUS CHÈRE DE LA RÉFÉRENCE, et c'est un choix de garde.
	 *
	 * Le client la choisit librement, et elle change le prix d'achat : mesuré
	 * sur le B&C #E150 en taille M, 3,00 EUR en blanc contre 3,78 en noir, soit
	 * 26 % d'écart sur le poste le plus gros. Un plancher vérifié sur le blanc
	 * est un plancher vérifié sur la commande la moins chère à servir, et le
	 * client qui commande du noir vend sous le plancher sans que rien ne bouge.
	 *
	 * Elle est GELÉE SUR LA LIGNE comme une vraie vente le fait
	 * (`Cart::persist_to_order`), parce que c'est ce que `Purchase::articles_for`
	 * lit. Sans elle, la référence ne se résout pas, le prix d'achat retombe sur
	 * le tarif générique de `garment_supply` et le contrôle mesure un plancher
	 * construit sur un textile qui n'est pas celui-là.
	 */
	$dearest = teeshoop_grille_dearest_colour( $product_id, $size );
	if ( null === $dearest ) {
		$fails[] = sprintf( '%s : aucun coloris de l’offre ne se résout à un article fournisseur avec un prix d’achat.', $ref );
		continue;
	}

	/*
	 * CE QUE LA PAGE PUBLIE VRAIMENT, lu par la MÊME méthode que la page.
	 *
	 * `ProductPage::grid_rows()` combine les deux raisons de ne pas publier un
	 * prix : le seuil d'autonomie (`Pricing::needs_quote`, qui connaît la
	 * quantité et le montant) et le colis (`Shipping::max_pieces`, qui connaît
	 * le poids). Recopier l'une des deux ici ferait un garde qui décide
	 * autrement que la page qu'il garde.
	 */
	$published = array();
	foreach ( ProductPage::grid_rows( $garment, $config, (int) round( (float) wc_get_weight( (float) $product->get_weight(), 'g' ) ) ) as $row ) {
		foreach ( $row['cells'] as $cell ) {
			$published[ (int) $row['sides'] ][ (int) $cell['qty'] ] = empty( $cell['needs_quote'] );
		}
	}

	/*
	 * TOUTES LES LIGNES DE LA GRILLE, PAS SEULEMENT « UNE FACE ».
	 *
	 * `product-price-grid.php` imprime une ligne par nombre de faces
	 * imprimables (`Garments::printable_sides_count`), donc trois sur un
	 * t-shirt. Une deuxième face, c'est un deuxième transfert, une deuxième
	 * pose et une deuxième surface de film : un contrôle qui ne mesure que la
	 * première valide un tiers du tableau et laisse les deux autres tiers
	 * dériver.
	 */
	$face_ids = array( 'front', 'back', 'sleeve' );

	foreach ( range( 1, Garments::printable_sides_count( $garment ) ) as $faces ) {

	$sides = array();
	foreach ( range( 0, $faces - 1 ) as $ts_i ) {
		$sides[] = array(
			'id'         => $face_ids[ $ts_i ] ?? ( 'face' . $ts_i ),
			'area_sq_cm' => $area_here,
			'pieces'     => array( array( 'w_cm' => $edge_here, 'h_cm' => $edge_here ) ),
		);
	}
	foreach ( $qtys as $qty ) {
		/*
		 * UNE COLONNE « SUR DEVIS » N'EST PAS UN PRIX PUBLIÉ.
		 *
		 * Au-delà du seuil d'autonomie, `product-price-grid.php` n'imprime pas
		 * de montant : la cellule est un lien « sur devis ». Un sweat à cent
		 * pièces passe les 2 000 EUR HT et tombe dans ce cas. Le contrôle lit la
		 * MÊME règle que le gabarit (`Pricing::needs_quote`) plutôt qu'une copie
		 * du seuil, et l'annonce, parce qu'une colonne sautée en silence est une
		 * couverture qu'on croit avoir.
		 */
		if ( empty( $published[ $faces ][ $qty ] ) ) {
			$skipped[] = sprintf( '%s (%s) %d face(s) x%d : la grille imprime « sur devis », pas un prix.', $ref, $garment, $faces, $qty );
			continue;
		}

		WC()->cart->empty_cart();
		$key = Cart::add(
			array(
				'product_id' => $product_id,
				'qty'        => $qty,
				'size_grid'  => array( $size => $qty ),
				'sides'      => $sides,
				'design_id'  => teeshoop_grille_design_id( $sides ),
			)
		);
		if ( is_wp_error( $key ) ) {
			/*
			 * DEUX REFUS DIFFÉRENTS, ET ILS NE VEULENT PAS DIRE LA MÊME CHOSE.
			 *
			 * `teeshoop_design_*` veut dire que la CRÉATION n'a pas pu être
			 * confirmée : le contrôle n'a rien mesuré. Tout autre code veut dire
			 * que la boutique refuse une colonne qu'elle publie, ce qui est un
			 * vrai défaut de la page.
			 *
			 * Ils étaient comptés ensemble, et ça a menti le 4 septembre 2026 :
			 * le Worker local tournait, `Design::verify` a répondu 404 sur
			 * l'identifiant de création du harnais (l'échappatoire de
			 * développement ne couvre que « injoignable », pas « inconnu »), et
			 * le garde a conclu « 111 colonnes sur 111 se vendent sous leur
			 * plancher, la boutique perd de l'argent à chaque vente ». Il n'avait
			 * mesuré aucun plancher. Le même garde, Worker arrêté, disait
			 * « toutes au-dessus ». Un contrôle dont le verdict dépend de ce qui
			 * écoute sur un port est pire qu'aucun contrôle, parce qu'on le croit.
			 */
			if ( str_starts_with( $key->get_error_code(), 'teeshoop_design_' ) ) {
				$blocked[] = sprintf( '%s %df x%d : %s (%s)', $ref, $faces, $qty, $key->get_error_message(), $key->get_error_code() );
			} else {
				$fails[] = sprintf( '%s %df x%d : le panier refuse la colonne publiée (%s)', $ref, $faces, $qty, $key->get_error_message() );
			}
			continue;
		}
		WC()->cart->calculate_totals();

		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		$order->set_billing_first_name( 'Garde' );
		$order->set_billing_last_name( 'Grille' );
		$order->set_billing_email( 'grille@example.test' );
		$order->set_billing_address_1( '12 rue de la Fabrique' );
		$order->set_billing_postcode( '75011' );
		$order->set_billing_city( 'Paris' );
		$order->set_billing_country( 'FR' );
		foreach ( $order->get_items() as $line ) {
			$line->update_meta_data( '_teeshoop_couleur', $dearest['studio'] );
			$line->update_meta_data( '_teeshoop_blank_colour', $dearest['term'] );
			$line->save();
		}
		$order->save();
		$made[] = $order->get_id();

		$report = Costing::refresh( wc_get_order( $order->get_id() ) );
		$plan   = is_array( $report['plan'] ?? null ) ? $report['plan'] : null;

		if ( null === $plan ) {
			$fails[] = sprintf( '%s %df x%d : aucun plancher calculable. « On n’a pas pu regarder » n’est pas « tout va bien ».', $ref, $faces, $qty );
			continue;
		}

		/*
		 * UN PLANCHER SANS LE TEXTILE N'EST PAS UN PLANCHER.
		 *
		 * Deux postes restent légitimement inconnus et le resteront jusqu'à ce
		 * que quelqu'un les chronomètre : les consommables (question 05) et la
		 * provision de défaut (question 27). Le textile, lui, est connu, c'est le
		 * plus gros poste, et la boutique sait le lire article par article. Une
		 * colonne dont il manque passe le plancher pour une bonne raison
		 * arithmétique et une mauvaise raison commerciale, donc elle est refusée.
		 *
		 * Mesuré le 4 septembre : les trois sweats sortaient à +112 EUR au-dessus
		 * de leur plancher parce que leur textile valait zéro, faute de coloris
		 * gelé sur la ligne.
		 */
		$unknown = (array) ( $report['cost']['unknown'] ?? array() );
		$blind   = array_values( array_intersect( $unknown, array( 'textile', 'transport_in', 'livraison', 'marquage', 'emballage' ) ) );
		if ( array() !== $blind ) {
			$fails[] = sprintf(
				'%s (%s) %df x%d : le coût ignore %s, donc le plancher est calculé sans. Un plancher amputé de son plus gros poste n’en est pas un.',
				$ref,
				$garment,
				$faces,
				$qty,
				implode( ', ', $blind )
			);
			continue;
		}

		$revenue = (int) $report['revenue']['total_ht'] - (int) $report['revenue']['discount_ht'];
		$floor   = (int) $plan['floor_ht'];
		$advised = (int) $plan['recommended_ht'];
		$under   = $floor - $revenue;

		$rows[] = array(
			'ref'      => (string) $ref,
			'garment'  => $garment,
			'faces'    => $faces,
			'taille'   => $size,
			'borne'    => (int) ( $report['parcel']['borne_ht'] ?? 0 ),
			'goods'    => (int) $report['revenue']['goods_ht'],
			'qty'      => $qty,
			'unit'     => (int) round( ( (int) $report['revenue']['goods_ht'] ) / max( 1, $qty ) ),
			'revenue'  => $revenue,
			'cost'     => (int) $report['cost']['total_ht'],
			'floor'    => $floor,
			'advised'  => $advised,
			'complete' => ! empty( $report['cost']['complete'] ),
			'under'    => $under,
		);

		if ( $under > 0 ) {
			$fails[] = sprintf(
				'%s (%s) %df x%d : encaissé %s, plancher %s, il manque %s',
				$ref,
				$garment,
				$faces,
				$qty,
				Money::format( $revenue ),
				Money::format( $floor ),
				Money::format( $under )
			);
		}
	}
	}
}

// Leave the mirror as it was found.
WC()->cart->empty_cart();
foreach ( $made as $id ) {
	$order = wc_get_order( $id );
	if ( $order instanceof \WC_Order ) {
		$order->delete( true );
	}
}

/*
 * `json` (a positional argument) dumps the measured rows and nothing else, so a tariff can be SOLVED
 * from the same numbers the gate refuses on rather than from a second
 * measurement. It was used on 4 September 2026 to derive the tariff that made
 * this gate green; keeping it means the next person can redo the derivation
 * instead of trusting it.
 */
if ( in_array( 'json', (array) ( $args ?? array() ), true ) ) {
	WP_CLI::log( (string) wp_json_encode( $rows ) );
	exit( 0 );
}

WP_CLI::log( '' );
WP_CLI::log(
	sprintf(
		'Grille publiée : %d quantité(s) %s, une face, %s cm de côté (%s cm², la borne du palier standard).',
		count( $qtys ),
		'(' . implode( ', ', $qtys ) . ')',
		Money::number( $edge, 1 ),
		Money::number( $area, 0 )
	)
);
WP_CLI::log( '' );
WP_CLI::log( '| Référence | Vêtement | Taille | Faces | Qté | Unité HT | Encaissé HT | Coût direct | Plancher | Conseillé | Écart au plancher |' );
WP_CLI::log( '|---|---|---|---|---|---|---|---|---|---|---|' );
foreach ( $rows as $r ) {
	WP_CLI::log(
		sprintf(
			'| %s | %s | %s | %d | %d | %s | %s | %s%s | %s | %s | %s |',
			$r['ref'],
			$r['garment'],
			$r['taille'],
			$r['faces'],
			$r['qty'],
			Money::format( $r['unit'] ),
			Money::format( $r['revenue'] ),
			Money::format( $r['cost'] ),
			$r['complete'] ? '' : ' *(incomplet)*',
			Money::format( $r['floor'] ),
			Money::format( $r['advised'] ),
			$r['under'] > 0
				? '**sous de ' . Money::format( $r['under'] ) . '**'
				: '+' . Money::format( -$r['under'] )
		)
	);
}
if ( array() !== $skipped ) {
	WP_CLI::log( sprintf( '%d colonne(s) non mesurée(s), parce que la grille n’y publie pas de prix :', count( $skipped ) ) );
	foreach ( $skipped as $why ) {
		WP_CLI::log( '  ' . $why );
	}
	WP_CLI::log( '' );
}

/*
 * LES REFUS D'ABORD, ET C'EST DÉLIBÉRÉ.
 *
 * Le contrôle sortait sur « aucune colonne mesurée » avant d'avoir imprimé
 * pourquoi elles avaient toutes été rejetées, donc il refusait sans dire de
 * quoi. Un garde qui ne publie pas ses raisons oblige à le relire pour le
 * comprendre, ce qui est exactement ce qu'il est censé éviter.
 */
if ( array() !== $notes ) {
	WP_CLI::log( sprintf( '%d mesure(s) prise(s) autrement, et pourquoi :', count( $notes ) ) );
	foreach ( $notes as $why ) {
		WP_CLI::log( '  ' . $why );
	}
	WP_CLI::log( '' );
}

if ( array() !== $fails ) {
	WP_CLI::log( sprintf( '%d refus :', count( $fails ) ) );
	foreach ( $fails as $why ) {
		WP_CLI::log( '  ' . $why );
	}
	WP_CLI::log( '' );
}

/*
 * RIEN MESURÉ EST UN ÉCHEC. Une gamme vide, un catalogue non importé ou une
 * grille sans colonne rendraient ce contrôle silencieusement vert, et « rien
 * trouvé » n'est pas « rien regardé » (CLAUDE.md section 5).
 */
if ( array() !== $blocked ) {
	WP_CLI::log( sprintf( '%d colonne(s) que le contrôle n’a PAS PU mesurer :', count( $blocked ) ) );
	foreach ( array_slice( $blocked, 0, 6 ) as $why ) {
		WP_CLI::log( '  ' . $why );
	}
	if ( count( $blocked ) > 6 ) {
		WP_CLI::log( sprintf( '  ... et %d autres, toutes pour la même raison.', count( $blocked ) - 6 ) );
	}
	WP_CLI::log( '' );
	WP_CLI::error(
		sprintf(
			'%d colonne(s) sur %d n’ont pas pu être chiffrées parce que la création du harnais n’a pas été confirmée. '
			. 'Ce n’est PAS un plancher franchi : le contrôle n’a rien mesuré et refuse de conclure. '
			. 'Vérifiez que le Worker de `teeshoop_settings.worker_url` accepte cette création, ou arrêtez-le.',
			count( $blocked ),
			count( $blocked ) + count( $rows ) + count( $fails )
		)
	);
}

if ( 0 === $offers ) {
	WP_CLI::error( 'Aucune offre de la gamme n’est publiée et achetable.' );
}
if ( array() === $rows && array() === $fails ) {
	WP_CLI::error( 'Aucune colonne mesurée et aucun refus : le contrôle n’a rien regardé.' );
}

if ( array() !== $fails ) {
	WP_CLI::error(
		sprintf(
			'%d colonne(s) publiée(s) sur %d se vendent sous leur plancher ou ne sont pas chiffrables. La boutique perd de l’argent à chaque vente de ces lignes.',
			count( $fails ),
			count( $fails ) + count( $rows )
		)
	);
}
if ( array() === $rows ) {
	WP_CLI::error( 'Aucune colonne mesurée. Le contrôle refuse plutôt que de conclure sur une grille qu’il n’a pas lue.' );
}

WP_CLI::success(
	sprintf(
		'%d colonne(s) publiée(s) sur %d offre(s), toutes au-dessus de leur plancher.',
		count( $rows ),
		$offers
	)
);
