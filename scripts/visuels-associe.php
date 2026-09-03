<?php
/**
 * Les visuels de l'associé, copiés depuis sa boutique dans un environnement.
 *
 *   npm run visuels                                     (le miroir docker)
 *   ssh teeshoop 'cd ~/myTiger-Preprod/… && wp eval-file -' < scripts/visuels-associe.php
 *
 * ── POURQUOI CE FICHIER ET PAS UNE COMMANDE DE L'EXTENSION ──────────────────
 *
 * C'est une migration : elle tourne une fois par environnement, elle porte en
 * dur des adresses de teeshoop.com, et elle n'a rien à faire dans un paquet
 * livré à la boutique. `scripts/purge-demo-fixture.php` a la même forme et pour
 * la même raison. `wp eval-file -` lit l'entrée standard, donc le fichier n'a
 * jamais besoin d'exister sur le serveur distant.
 *
 * ── CE QU'IL COPIE, ET D'OÙ ─────────────────────────────────────────────────
 *
 * Onze photographies de personnes portant des vêtements marqués, attachées aux
 * termes `product_cat` de teeshoop.com depuis mai 2025, plus le logo et une
 * icône de site dérivée de sa marque. Rien n'est inventé, rien n'est généré :
 * ce sont ses fichiers, publics, relevés le 03/09/2026 avec `wp term meta get
 * <id> thumbnail_id` sur sa production.
 *
 * ELLES FONT 170 x 170 ET C'EST LEUR TAILLE D'ORIGINE. Il n'existe pas de
 * version plus grande sur le serveur : `find` ne rend que le fichier lui-même
 * et ses vignettes 150 et 75. Le thème dessine donc la tuile à 96 px (128 px
 * au-delà de 45 rem), ce qu'un fichier de 170 px couvre encore.
 *
 * ── CE QU'IL NE FAIT PAS ────────────────────────────────────────────────────
 *
 *   - il ne crée aucune catégorie. Une photographie dont le terme n'existe pas
 *     ici est signalée et sautée : fabriquer un rayon vide pour pouvoir y
 *     accrocher une belle image est exactement la fiction que CLAUDE.md
 *     paragraphe 7 interdit ;
 *   - il ne remplace pas une photographie déjà posée à la main. Un terme qui a
 *     déjà une vignette est laissé tel quel, sauf avec --forcer ;
 *   - il ne touche à aucun produit, à aucune commande, à aucun client.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────
 *
 * Chaque pièce jointe créée ici porte `_teeshoop_visuel_source`, l'adresse d'où
 * elle vient. Une deuxième exécution la retrouve par ce méta et ne re-télécharge
 * rien. Relancer ne coûte que des requêtes de base.
 *
 * Sortie : 0 tout est en place, 1 au moins une pièce manque à l'appel.
 *
 * @package Teeshoop\Outils
 */

/*
 * PAS DE `declare( strict_types = 1 )` ICI, et ce n'est pas un oubli.
 * `wp eval-file` passe le contenu du fichier à `eval()`, et PHP exige que cette
 * déclaration soit la toute première instruction d'un SCRIPT : dans du code
 * évalué elle est une erreur fatale. Mesuré le 03/09/2026, avec précisément ce
 * message. Tout le reste du dépôt la porte ; ce fichier ne le peut pas.
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	exit( 1 );
}

require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/image.php';

/** Vrai si l'appelant a passé --forcer, qui réécrit une vignette déjà posée. */
$ts_forcer = in_array( '--forcer', (array) ( $GLOBALS['argv'] ?? array() ), true );

const TS_BASE = 'https://www.teeshoop.com/wp-content/uploads/';

/**
 * Les onze catégories, avec le nom EXACT qu'il leur donne et sa photographie.
 *
 * Le nom est repris tel quel parce que la réponse 31 demande de conserver
 * « l'organisation déjà définie », et qu'une casse est une partie du nom : sa
 * boutique écrit « T-Shirts », la nôtre écrivait « T-shirts ». Le slug, lui,
 * n'est jamais touché : le changer casserait chaque adresse déjà indexée.
 */
$ts_categories = array(
	'T-Shirts'           => '2025/05/T-shirts-1.png',
	'Polos'              => '2025/05/Polos-1.png',
	'Sweats'             => '2025/05/Sweatshirts-1.png',
	'Vestes'             => '2025/05/Vestes-1.png',
	'Débardeurs'         => '2025/05/Debardeurs-1.png',
	'Sport'              => '2025/05/Sport-1.png',
	'Casquettes'         => '2025/05/Casquettes-1.png',
	'Bonnets'            => '2025/05/Bonnets-1.png',
	'Tabliers'           => '2025/05/Tabliers-1.png',
	'Sacs & tote bags'   => '2025/05/Sacs-Totebags-1.png',
	'Maison'             => '2025/05/Maison-1.png',
);

/**
 * Réduit un nom de catégorie à une clé comparable.
 *
 * « T-Shirts », « T-shirts » et « t shirts » sont le même rayon. Les accents
 * partent parce que « Débardeurs » et « Debardeurs » se croisent dans les deux
 * sens selon qui a saisi le terme.
 */
function ts_clef( string $nom ): string {
	$sans = remove_accents( $nom );
	$sans = strtolower( $sans );
	return (string) preg_replace( '/[^a-z0-9]+/', '', $sans );
}

/**
 * Télécharge une adresse dans la médiathèque, une seule fois.
 *
 * Rend l'identifiant de la pièce jointe, ou 0. L'échec est explicite : une
 * image qui n'arrive pas n'est jamais remplacée par une autre.
 */
function ts_media( string $url, string $titre ): int {
	$connus = get_posts(
		array(
			'post_type'   => 'attachment',
			'post_status' => 'inherit',
			'numberposts' => 1,
			'fields'      => 'ids',
			'meta_key'    => '_teeshoop_visuel_source', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
			'meta_value'  => $url, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
		)
	);
	if ( ! empty( $connus ) ) {
		return (int) $connus[0];
	}

	$tmp = download_url( $url, 60 );
	if ( is_wp_error( $tmp ) ) {
		WP_CLI::warning( sprintf( '%s : %s', $url, $tmp->get_error_message() ) );
		return 0;
	}

	$id = media_handle_sideload(
		array(
			'name'     => basename( wp_parse_url( $url, PHP_URL_PATH ) ?: 'visuel.png' ),
			'tmp_name' => $tmp,
		),
		0,
		$titre
	);
	if ( is_wp_error( $id ) ) {
		@unlink( $tmp ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- le fichier temporaire peut déjà avoir été consommé.
		WP_CLI::warning( sprintf( '%s : %s', $url, $id->get_error_message() ) );
		return 0;
	}

	update_post_meta( (int) $id, '_teeshoop_visuel_source', $url );
	return (int) $id;
}

/**
 * Verse dans la médiathèque un fichier livré avec le thème.
 *
 * Le logo et l'icône passent par ici et non par le réseau. Pour le logo c'est
 * une correction : le télécharger depuis teeshoop.com à chaque environnement a
 * rendu « Too Many Requests » le 03/09/2026, son hébergement limitant les
 * requêtes rapprochées, et l'exécution s'est terminée en erreur pour un fichier
 * que le dépôt contenait déjà, octet pour octet. Un visuel de marque est livré
 * avec le thème ; seules les photographies des rayons, qui sont de la DONNÉE et
 * qu'un administrateur doit pouvoir changer sans redéploiement, viennent du
 * réseau.
 */
function ts_media_theme( string $fichier, string $titre ): int {
	$chemin = get_template_directory() . '/assets/images/' . $fichier;
	$marque = 'theme:' . $fichier;
	if ( ! file_exists( $chemin ) ) {
		WP_CLI::warning( sprintf( 'assets/images/%s est absente du thème actif.', $fichier ) );
		return 0;
	}
	$connus = get_posts(
		array(
			'post_type'   => 'attachment',
			'post_status' => 'inherit',
			'numberposts' => 1,
			'fields'      => 'ids',
			'meta_key'    => '_teeshoop_visuel_source', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
			'meta_value'  => $marque, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
		)
	);
	if ( ! empty( $connus ) ) {
		return (int) $connus[0];
	}
	$copie = wp_tempnam( $fichier );
	copy( $chemin, $copie );
	$id = media_handle_sideload( array( 'name' => $fichier, 'tmp_name' => $copie ), 0, $titre );
	if ( is_wp_error( $id ) ) {
		WP_CLI::warning( sprintf( '%s : %s', $fichier, $id->get_error_message() ) );
		return 0;
	}
	update_post_meta( (int) $id, '_teeshoop_visuel_source', $marque );
	return (int) $id;
}

/* ── Les catégories ───────────────────────────────────────────────────────── */

$ts_poses    = 0;
$ts_deja     = 0;
$ts_absents  = array();
$ts_echecs   = 0;
$ts_renommes = 0;

// Un index des termes d'ici, par clé comparable.
$ts_index = array();
foreach ( (array) get_terms( array( 'taxonomy' => 'product_cat', 'hide_empty' => false ) ) as $ts_t ) {
	if ( $ts_t instanceof WP_Term ) {
		$ts_index[ ts_clef( $ts_t->name ) ] = $ts_t;
	}
}

foreach ( $ts_categories as $ts_nom => $ts_chemin ) {
	$ts_clef = ts_clef( $ts_nom );
	if ( ! isset( $ts_index[ $ts_clef ] ) ) {
		$ts_absents[] = $ts_nom;
		continue;
	}
	$ts_term = $ts_index[ $ts_clef ];

	// Son nom exact, slug intact.
	if ( $ts_term->name !== $ts_nom ) {
		wp_update_term( $ts_term->term_id, 'product_cat', array( 'name' => $ts_nom ) );
		WP_CLI::log( sprintf( '  renommé : « %s » devient « %s » (slug %s inchangé)', $ts_term->name, $ts_nom, $ts_term->slug ) );
		++$ts_renommes;
	}

	$ts_actuel = (int) get_term_meta( $ts_term->term_id, 'thumbnail_id', true );
	if ( $ts_actuel > 0 && ! $ts_forcer ) {
		++$ts_deja;
		continue;
	}

	$ts_id = ts_media( TS_BASE . $ts_chemin, $ts_nom );
	if ( $ts_id <= 0 ) {
		++$ts_echecs;
		continue;
	}
	update_term_meta( $ts_term->term_id, 'thumbnail_id', $ts_id );
	WP_CLI::log( sprintf( '  photo posée : %s (pièce jointe %d)', $ts_nom, $ts_id ) );
	++$ts_poses;
	// Son hébergement mutualisé répond 429 sur une rafale. Onze fichiers valent
	// bien onze secondes ; c'est sa machine, pas la nôtre.
	sleep( 1 );
}

/* ── Le logo et l'icône ───────────────────────────────────────────────────── */

$ts_logo_id = (int) get_theme_mod( 'custom_logo', 0 );
if ( $ts_logo_id <= 0 || $ts_forcer ) {
	$ts_logo_id = ts_media_theme( 'logo-teeshoop.png', 'Logo Teeshoop' );
	if ( $ts_logo_id > 0 ) {
		set_theme_mod( 'custom_logo', $ts_logo_id );
		WP_CLI::log( sprintf( '  logo posé sur custom-logo (pièce jointe %d)', $ts_logo_id ) );
	} else {
		++$ts_echecs;
	}
} else {
	WP_CLI::log( '  logo : déjà réglé, laissé tel quel' );
}

/*
 * L'ICÔNE DE SITE VIENT DU THÈME ET NON DE SA BOUTIQUE, parce qu'il n'en a pas :
 * teeshoop.com ne déclare aucun `site_icon`, ce qui est précisément pourquoi un
 * onglet et un favori de son site sont vides aujourd'hui. Celle-ci est la marque
 * orange de son logo, détourée et posée sur son navy, 512 x 512. WordPress
 * refuse une icône de moins de 512 px de côté.
 */
$ts_icone_id = (int) get_option( 'site_icon', 0 );
if ( $ts_icone_id <= 0 || $ts_forcer ) {
	$ts_icone_id = ts_media_theme( 'icone-teeshoop.png', 'Icône Teeshoop' );
	if ( $ts_icone_id > 0 ) {
		update_option( 'site_icon', $ts_icone_id );
		WP_CLI::log( sprintf( '  icône de site posée (pièce jointe %d)', $ts_icone_id ) );
	} else {
		++$ts_echecs;
	}
} else {
	WP_CLI::log( '  icône de site : déjà réglée, laissée telle quelle' );
}

/* ── Le compte rendu ──────────────────────────────────────────────────────── */

WP_CLI::log( '' );
WP_CLI::log(
	sprintf(
		'%d photo(s) posée(s), %d déjà en place, %d renommage(s), %d catégorie(s) absente(s) ici, %d échec(s).',
		$ts_poses,
		$ts_deja,
		$ts_renommes,
		count( $ts_absents ),
		$ts_echecs
	)
);

if ( ! empty( $ts_absents ) ) {
	/*
	 * DIT ET PAS CRÉÉ. Huit de ses onze rayons n'ont de produit ni ici ni chez
	 * lui : l'import fournisseur ne va pas les chercher parce que le studio
	 * imprime le haut du corps. Les créer vides pour pouvoir y accrocher une
	 * photographie ferait onze belles tuiles dont huit mènent à « aucun
	 * produit ». Le jour où l'une d'elles est remplie, relancer ce script y
	 * pose sa photo.
	 */
	WP_CLI::log( 'Sans équivalent dans cette boutique, donc sautées : ' . implode( ', ', $ts_absents ) . '.' );
}

if ( $ts_echecs > 0 ) {
	WP_CLI::error( sprintf( '%d visuel(s) n’ont pas pu être posés.', $ts_echecs ) );
}
WP_CLI::success( 'Visuels de l’associé en place.' );
