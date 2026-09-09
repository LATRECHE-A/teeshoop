<?php
/**
 * L'adaptateur fournisseur : tout ce que le reste de la boutique sait du dehors.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI CHANGE LE 9 SEPTEMBRE 2026, ET CE QUI NE CHANGE PAS
 *
 * L'associé a tranché : un seul fournisseur. L'ancien passait par le Worker
 * Cloudflare, qui lisait des documents XML et les recomposait. Le nouveau parle
 * JSON, directement à WordPress, et le Worker n'est plus sur ce chemin du tout.
 *
 * NE CHANGE PAS : la SURFACE de cette classe. `Purchase`, `Costing`, `Cost`,
 * `Gamme`, `Shelf` et `Importer` lisent exactement les mêmes méthodes, avec les
 * mêmes formes de retour, et aucun de ces fichiers n'est touché. C'est
 * précisément ce pour quoi cette couture existait, et c'est la première fois
 * qu'on s'en sert.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI LE WORKER SORT DU CHEMIN DU CATALOGUE
 *
 * Mesuré le 9 septembre 2026 contre le vrai service :
 *
 *   le catalogue complet fait 3 241 produits sur 65 pages, 94,1 s et 250,2 Mo ;
 *   il n'existe AUCUN point d'entrée par référence, seulement la pagination ;
 *   un Worker gratuit plafonne à 50 sous-requêtes par invocation.
 *
 * Deux cent cinquante mégaoctets ne traversent pas un Worker, et « donne-moi la
 * référence BC01B » n'est pas une question que ce service sait entendre. Le
 * catalogue vit donc dans une TABLE DE DÉPÔT ici, remplie par une marche
 * paginée, et `entry()` la relit au lieu d'aller redemander.
 *
 * LE COÛT DE CE DÉPÔT A ÉTÉ MESURÉ AVANT D'ÊTRE CHOISI : 254,2 Mo de JSON brut
 * se compressent en 8,1 Mo, soit 2,5 ko par produit. Garder la charge utile
 * ENTIÈRE plutôt qu'un extrait coûte donc 2,8 Mo de plus que le strict
 * nécessaire (5,3 Mo compressés), et paie une propriété qui vaut bien mieux :
 * changer la cartographie ne demande pas de remarcher les 65 pages du
 * fournisseur.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE PRIX ET LE STOCK NE VIENNENT PAS D'ICI
 *
 * Le service publie trois sources de prix et deux de stock. Mesurées le même
 * jour, sur les mêmes codes :
 *
 *   le flux de prix en masse est INCOMPLET (31 847 codes sur 75 088 n'y sont
 *   pas, soit 42 %) et il est FAUX sur 29 des 137 codes comparables (21 %),
 *   avec une valeur 10,80 répétée à l'identique sur des références sans rapport,
 *   qui a toutes les apparences d'une ligne par défaut ;
 *
 *   le flux de stock en masse date du 29 avril 2026 en préproduction, soit
 *   quatre mois, et donne 127 là où le service en direct donne 173 ;
 *
 *   `GET /api/products/price-stock` répond pour TOUS les codes, y compris les
 *   31 847 que le flux de masse ignore, et c'est la seule source à la fois
 *   complète et actuelle.
 *
 * Donc : le prix payé et la disponibilité viennent de `Disponibilite`, qui
 * n'interroge que celle-là. Ce fichier ne lit jamais `publicPrice`, qui n'est
 * pas un prix de vente conseillé malgré son nom : mesuré à 3 quand notre prix
 * d'achat est 4 sur la même référence.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

/*
 * `TEESHOOP_TEST` joint la garde parce que `Purchase::TRANSMITTABLE` nomme
 * `Supply::SOURCE` et que le lanceur de tests purs charge `Purchase.php`.
 */
defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Supply {

	/**
	 * Le code d'adaptateur estampillé sur chaque article importé.
	 *
	 * UN CODE, PAS UN NOM, et l'écart est tenu par `scripts/php-guard.mjs` :
	 * aucun nom de fournisseur ne vit dans ce greffon. Ce dont la boutique a
	 * besoin pour être double-sourcée n'est pas QUI est au bout de la route,
	 * c'est QUEL adaptateur a écrit un article, pour que deux fournisseurs
	 * cohabitent dans un catalogue et qu'un panier refuse de les mélanger.
	 *
	 * `ws` reste la valeur, inchangée depuis l'ancien service, et c'est
	 * délibéré : 46 572 déclinaisons du miroir la portent déjà. La changer
	 * rendrait orphelin tout ce qui a été importé, pour renommer une chose que
	 * personne ne lit comme un nom.
	 */
	public const SOURCE = 'ws';

	/** La table de dépôt, sans le préfixe de la base. */
	private const TABLE = 'teeshoop_supply_raw';

	/**
	 * Produits par page de la marche du catalogue.
	 *
	 * Le service plafonne à 50 et le documente. Mesuré : 1,45 s en moyenne par
	 * page pleine, 4 Mo décompressés, 65 pages pour tout le catalogue.
	 */
	private const PAGE = 50;

	/**
	 * Format de date que le service attend sur ses filtres, et il n'est pas ISO.
	 *
	 * `d-m-Y`, imposé par un motif dans son propre schéma
	 * (`^\d{2}-\d{2}-\d{4}$`). Une date ISO passe le typage et ne filtre rien,
	 * ce qui rend une synchronisation incrémentale silencieusement complète :
	 * le pire des deux mondes, puisque c'est long ET que ça ressemble à un
	 * succès.
	 */
	private const DATE_FMT = 'd-m-Y';

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/** Ce qui manque pour importer, ou '' si rien ne manque. */
	public static function unconfigured(): string {
		return SupplyHttp::unconfigured();
	}

	/**
	 * Le mode du compte fournisseur : `test`, `live` ou `unknown`.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * IL EST DÉCLARÉ, PAS DEVINÉ, ET `unknown` BLOQUE.
	 *
	 * L'ancien service avait un point d'entrée qui disait dans quel mode le
	 * compte tournait. Celui-ci n'en a pas : la préproduction et la production
	 * sont deux adresses, et rien dans une réponse ne dit laquelle on interroge.
	 * Deviner à partir du nom d'hôte serait exactement le genre de règle qui
	 * tient jusqu'au jour où le fournisseur renomme son domaine, et ce jour-là
	 * elle enverrait une commande réelle en croyant faire un essai.
	 *
	 * `TEESHOOP_SUPPLY_MODE` est donc déclarée à la main, à côté des
	 * identifiants qu'elle qualifie, et son absence vaut `unknown`, qui refuse
	 * toute commande. Une commande fournisseur est de l'argent qui part : ne
	 * pas savoir n'autorise rien.
	 *
	 * @return array{mode:string,error:string,at:string}
	 */
	public static function mode(): array {
		$raw  = defined( 'TEESHOOP_SUPPLY_MODE' ) ? strtolower( trim( (string) constant( 'TEESHOOP_SUPPLY_MODE' ) ) ) : '';
		$mode = in_array( $raw, array( 'test', 'live' ), true ) ? $raw : 'unknown';

		return array(
			'mode'  => $mode,
			'error' => 'unknown' === $mode
				? 'Le mode du compte fournisseur n’est pas déclaré. Ajoutez define( \'TEESHOOP_SUPPLY_MODE\', \'test\' ); ou \'live\' dans wp-config.php, à côté des identifiants.'
				: '',
			'at'    => gmdate( 'c' ),
		);
	}

	// -----------------------------------------------------------------------
	// La table de dépôt
	// -----------------------------------------------------------------------

	/** Le nom complet de la table de dépôt. */
	public static function table(): string {
		global $wpdb;
		return $wpdb->prefix . self::TABLE;
	}

	/**
	 * Crée ou met à jour la table de dépôt.
	 *
	 * Appelée à l'activation et par la migration, comme les autres tables de ce
	 * greffon. `dbDelta` est exigeant sur la mise en forme : deux espaces après
	 * PRIMARY KEY, un type par ligne, pas de virgule finale.
	 */
	public static function install(): void {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table   = self::table();
		$collate = $wpdb->get_charset_collate();

		/*
		 * `payload` EST DU BINAIRE COMPRESSÉ, PAS DU TEXTE.
		 *
		 * LONGBLOB et non LONGTEXT : `gzcompress` produit des octets qui ne sont
		 * pas de l'UTF-8, et MySQL les tronquerait ou les remplacerait dans une
		 * colonne texte, silencieusement, ce qui rend un catalogue illisible
		 * sans qu'aucune requête n'échoue.
		 */
		dbDelta(
			"CREATE TABLE {$table} (
				ref varchar(64) NOT NULL,
				kind varchar(16) NOT NULL DEFAULT 'other',
				shelf varchar(16) NOT NULL DEFAULT 'autre',
				sleeve varchar(16) NOT NULL DEFAULT 'unknown',
				updated_at datetime NULL,
				seen_at datetime NOT NULL,
				gone tinyint(1) NOT NULL DEFAULT 0,
				payload longblob NOT NULL,
				PRIMARY KEY  (ref),
				KEY kind_shelf (kind,shelf),
				KEY seen_at (seen_at),
				KEY gone (gone)
			) {$collate};"
		);
	}

	/**
	 * Marche le catalogue du fournisseur et le dépose localement.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * `since` EST CE QUI REND CETTE OPÉRATION QUOTIDIENNE PLUTÔT QUE MENSUELLE
	 *
	 * Sans lui, 65 pages, 94 s, 250 Mo. Avec, le service ne rend que ce qui a
	 * bougé, et une journée ordinaire tient en quelques pages. La marche
	 * complète reste nécessaire une fois, et après chaque changement de
	 * cartographie, mais elle n'est pas le régime de croisière.
	 *
	 * `budget` borne le temps de mur, parce qu'un hébergement mutualisé coupe à
	 * `max_execution_time` sans prévenir et qu'une marche coupée au milieu doit
	 * pouvoir reprendre. Elle le peut : chaque page est écrite avant que la
	 * suivante soit demandée, et `next` dit où reprendre.
	 *
	 * @param array{since?:string,page?:int,budget?:int,full?:bool} $opts
	 * @return array{ok:bool,pages:int,products:int,next:?int,total:int,complete:bool,seconds:float,error?:string}
	 */
	public static function sync( array $opts = array() ): array {
		$why = self::unconfigured();
		if ( '' !== $why ) {
			return array(
				'ok'       => false,
				'pages'    => 0,
				'products' => 0,
				'next'     => null,
				'total'    => 0,
				'complete' => false,
				'seconds'  => 0.0,
				'error'    => $why,
			);
		}

		$since  = (string) ( $opts['since'] ?? '' );
		$page   = max( 1, (int) ( $opts['page'] ?? 1 ) );
		$budget = max( 5, (int) ( $opts['budget'] ?? 240 ) );
		$start  = microtime( true );

		$query = array(
			'perPage' => self::PAGE,
			'page'    => $page,
		);
		if ( '' !== $since ) {
			$query['sinceUpdated'] = $since;
		}

		$pages    = 0;
		$products = 0;
		$total    = 0;
		$next     = null;
		$au_bout  = false;

		while ( true ) {
			$query['page'] = $page;
			$read          = SupplyHttp::get( '/api/products/products', $query );
			if ( ! $read['ok'] ) {
				return array(
					'ok'       => false,
					'pages'    => $pages,
					'products' => $products,
					'next'     => $page,
					'total'    => $total,
					'complete' => false,
					'seconds'  => round( microtime( true ) - $start, 2 ),
					'error'    => (string) $read['error'],
				);
			}

			$body  = (array) $read['body'];
			$total = (int) ( $body['totalNumberPage'] ?? 0 );
			$rows  = is_array( $body['products'] ?? null ) ? $body['products'] : array();

			foreach ( $rows as $product ) {
				if ( is_array( $product ) && self::store( $product ) ) {
					++$products;
				}
			}

			++$pages;

			/*
			 * ─────────────────────────────────────────────────────────────────
			 * ARRIVER AU BOUT ET S'ARRÊTER SONT DEUX CHOSES, ET LES CONFONDRE
			 * DÉPUBLIE LA BOUTIQUE.
			 *
			 * Ce test était `$page >= $total || array() === $rows`, et il posait
			 * `complete` derrière. Deux façons de mentir, prouvées en exécutant
			 * `sync()` contre un transport bouchonné le 9 septembre 2026 :
			 *
			 *   une page vide au milieu d'une marche de 65 pages arrêtait tout
			 *   et déclarait la marche complète, 62 pages jamais demandées ;
			 *
			 *   un `totalNumberPage` absent ou renommé (ce que rend un document
			 *   d'erreur JSON) donnait `$total = 0`, et `1 >= 0` est vrai.
			 *
			 * Ce que cela produit ensuite : `Importer::delist()` met au brouillon
			 * chaque produit publié dont la référence manque au plan. Sur ce
			 * miroir, 492 produits des familles imprimables, 2 309 avec
			 * `--famille=all`, et son propre commentaire dit que « personne ne
			 * défait ça à la main ».
			 *
			 * On ne déclare donc la fin QUE sur le compte de pages annoncé, et
			 * une page vide sous ce compte est une reprise, pas une fin.
			 */
			$au_bout = $total > 0 && $page >= $total;
			if ( $au_bout ) {
				break;
			}
			/*
			 * UN COMPTE DE PAGES ABSENT ARRÊTE LA MARCHE, IL NE LA FAIT PAS
			 * TOURNER EN ROND.
			 *
			 * La première version de ce correctif ne testait que `$au_bout`, et
			 * une réponse sans `totalNumberPage` (ce que rend un document
			 * d'erreur JSON) donnait `$total = 0`, donc jamais la fin : la
			 * sonde a compté 26 748 pages demandées avant que le budget de
			 * temps ne coupe. Corriger « on s'arrête trop tôt » en « on ne
			 * s'arrête jamais » aurait remplacé une dépublication de masse par
			 * un martèlement du fournisseur.
			 *
			 * Sans compte de pages on ne sait pas où l'on est, donc on s'arrête
			 * et on le dit : `next` non nul, `complete` faux, rien n'est
			 * dépublié.
			 */
			if ( $total <= 0 ) {
				$next = $page;
				break;
			}
			if ( array() === $rows ) {
				$next = $page;
				break;
			}
			++$page;

			/*
			 * ON S'ARRÊTE AVANT DE COMMENCER UNE PAGE QU'ON NE FINIRA PAS.
			 *
			 * 1,45 s mesurés par page, la plus lente à 1,93. On garde trois
			 * secondes de marge : dépasser `max_execution_time` au milieu d'une
			 * écriture laisse la moitié d'une page dans la table sans que rien
			 * ne le dise, et c'est le genre d'état qu'on ne détecte qu'à
			 * l'import suivant.
			 */
			if ( microtime( true ) - $start > $budget - 3 ) {
				$next = $page;
				break;
			}
		}

		return array(
			'ok'       => true,
			'pages'    => $pages,
			'products' => $products,
			'next'     => $next,
			'total'    => $total,
			/*
			 * `complete` DÉCIDE SI L'IMPORT A LE DROIT DE DÉRÉFÉRENCER.
			 *
			 * Une marche partielle ne prouve pas qu'une référence a disparu :
			 * elle prouve qu'on ne l'a pas croisée. Et une marche
			 * INCRÉMENTALE, même finie, ne la prouve pas non plus, puisqu'elle
			 * ne montre que ce qui a bougé. Les deux cas rendent `false`, et
			 * `Importer` ne retire alors rien.
			 */
			'complete' => null === $next && '' === $since && $au_bout,
			'seconds'  => round( microtime( true ) - $start, 2 ),
		);
	}

	/**
	 * Marque comme disparues les références qu'une marche COMPLÈTE n'a pas revues.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * `seen_at` EXISTAIT ET PERSONNE NE LE LISAIT.
	 *
	 * La colonne et son index ont été créés pour ça, et rien ne les interrogeait :
	 * `gone` ne pouvait être posé que par le fournisseur continuant à publier un
	 * produit avec une date de suppression, ce qui est 1 ligne sur 3 241. Un
	 * fournisseur qui retire simplement une référence de l'assortiment du compte,
	 * sans pierre tombale, laissait la ligne à `gone = 0` pour toujours : la
	 * fiche restait publiée avec son dernier prix et son dernier stock, et la
	 * boutique ne refusait qu'à l'ajout au panier, après que le client a dessiné.
	 *
	 * SEULEMENT APRÈS UNE MARCHE COMPLÈTE. Une marche partielle ou incrémentale
	 * n'a pas croisé le catalogue entier, donc une référence qu'elle n'a pas vue
	 * n'est pas une référence disparue. C'est la même règle que `complete` porte
	 * pour l'import, une couche plus bas.
	 *
	 * @param string $depuis Début de la marche, `Y-m-d H:i:s` UTC.
	 * @return int Combien de références viennent d'être marquées.
	 */
	public static function mark_gone( string $depuis ): int {
		global $wpdb;
		if ( '' === $depuis ) {
			return 0;
		}
		$n = $wpdb->query(
			$wpdb->prepare(
				'UPDATE `' . self::table() . '` SET gone = 1 WHERE gone = 0 AND seen_at < %s',
				$depuis
			)
		);
		return false === $n ? 0 : (int) $n;
	}

	/**
	 * Reclasse le dépôt sans reparler au fournisseur.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * PARCE QUE LE CLASSEMENT EST FIGÉ DANS TROIS COLONNES.
	 *
	 * L'en-tête de ce fichier justifie de garder la charge utile ENTIÈRE en
	 * disant que « changer la cartographie ne demande pas de remarcher les 65
	 * pages ». C'était faux pour la seule partie du classement qui décide ce que
	 * la boutique publie et à quel plancher : `kind`, `shelf` et `sleeve` sont
	 * dérivés à l'écriture et `references()` filtre dessus.
	 *
	 * Conséquence, constatée en corrigeant le classement des vestes softshell :
	 * rien ne bougeait, et une marche incrémentale ne bougeait rien non plus,
	 * pendant que les deux moitiés avaient l'air saines.
	 *
	 * `wp teeshoop couleurs reclasser` existe depuis longtemps pour exactement
	 * cette forme de problème.
	 *
	 * @return array{lus:int,changes:int}
	 */
	public static function reclassify(): array {
		global $wpdb;
		$table = self::table();
		$refs  = $wpdb->get_col( 'SELECT ref FROM `' . $table . '`' );
		$lus   = 0;
		$chg   = 0;

		foreach ( (array) $refs as $ref ) {
			$product = self::raw( (string) $ref );
			if ( null === $product ) {
				continue;
			}
			++$lus;
			$f = self::classify( $product );
			$n = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . $table . '` SET kind = %s, shelf = %s, sleeve = %s
					  WHERE ref = %s AND ( kind <> %s OR shelf <> %s OR sleeve <> %s )',
					$f['kind'],
					$f['shelf'],
					$f['sleeve'],
					(string) $ref,
					$f['kind'],
					$f['shelf'],
					$f['sleeve']
				)
			);
			if ( false !== $n && $n > 0 ) {
				++$chg;
			}
		}

		return array(
			'lus'     => $lus,
			'changes' => $chg,
		);
	}

	/**
	 * Écrit un produit dans le dépôt.
	 *
	 * @param array<string,mixed> $product La charge utile telle que reçue.
	 */
	private static function store( array $product ): bool {
		global $wpdb;

		$ref = self::text( $product['reference'] ?? '' );
		if ( '' === $ref || strlen( $ref ) > 64 ) {
			return false;
		}

		$payload = gzcompress( (string) wp_json_encode( $product ), 6 );
		if ( false === $payload ) {
			return false;
		}

		$facts = self::classify( $product );

		/*
		 * `deletedAt` NON NUL VEUT DIRE « RETIRÉ », et on le garde en le
		 * marquant plutôt qu'en l'effaçant : `Importer` a besoin de savoir
		 * qu'une référence a existé pour la mettre au brouillon proprement,
		 * et une ligne absente ne se distingue pas d'une ligne jamais vue.
		 */
		$gone = ( null !== ( $product['deletedAt'] ?? null ) && '' !== (string) $product['deletedAt'] ) ? 1 : 0;

		/*
		 * LE RETOUR EST LU. `$wpdb->query()` rend `false` sur erreur, et il était
		 * jeté : `sync()` comptait le produit comme déposé et la commande
		 * imprimait « 3 241 produits déposés », une affirmation qu'elle n'avait
		 * pas mesurée. C'est le seul endroit qui pouvait annoncer un dépôt
		 * complet sur une table vide, ce qui est exactement l'entrée que le
		 * défaut ci-dessus transforme en dépublication de masse.
		 */
		$ecrit = $wpdb->query(
			$wpdb->prepare(
				'INSERT INTO `' . self::table() . '` (ref, kind, shelf, sleeve, updated_at, seen_at, gone, payload)
				 VALUES (%s, %s, %s, %s, %s, %s, %d, %s)
				 ON DUPLICATE KEY UPDATE kind = VALUES(kind), shelf = VALUES(shelf), sleeve = VALUES(sleeve),
				   updated_at = VALUES(updated_at), seen_at = VALUES(seen_at), gone = VALUES(gone), payload = VALUES(payload)',
				$ref,
				$facts['kind'],
				$facts['shelf'],
				$facts['sleeve'],
				self::mysql_date( (string) ( $product['updatedAt'] ?? '' ) ),
				gmdate( 'Y-m-d H:i:s' ),
				$gone,
				$payload
			)
		);

		return false !== $ecrit;
	}

	/**
	 * Les références que la boutique doit porter, telles que le dépôt les
	 * connaît.
	 *
	 * @param string $kind      `printable` (défaut), `tee`, `polo`, `sweat`, `all`.
	 * @param int    $want      S'arrêter à ce nombre. 0 = tout.
	 * @param int    $max_calls Ignoré : la lecture est locale et ne coûte pas
	 *                          d'appel. Gardé dans la signature parce que
	 *                          `Importer` le passe et qu'un paramètre retiré
	 *                          d'une couture est un paramètre qu'un appelant
	 *                          passe encore.
	 * @return array{ok:bool,refs:string[],complete:bool,dropped?:int,calls?:int,seconds?:float,error?:string}
	 */
	public static function references( string $kind = 'printable', int $want = 0, int $max_calls = 200 ): array {
		global $wpdb;
		unset( $max_calls );

		$kinds = Catalogue::families( $kind );
		if ( array() === $kinds ) {
			return array(
				'ok'       => false,
				'refs'     => array(),
				'complete' => false,
				'error'    => 'Famille inconnue : « ' . $kind . ' ».',
			);
		}

		$start = microtime( true );
		$in    = implode( ',', array_fill( 0, count( $kinds ), '%s' ) );
		$sql   = 'SELECT ref FROM `' . self::table() . '` WHERE gone = 0 AND kind IN (' . $in . ') ORDER BY ref ASC';
		$args  = $kinds;
		if ( $want > 0 ) {
			$sql   .= ' LIMIT %d';
			$args[] = $want;
		}

		$refs = $wpdb->get_col( $wpdb->prepare( $sql, ...$args ) );
		$refs = is_array( $refs ) ? array_map( 'strval', $refs ) : array();

		/*
		 * UN DÉPÔT VIDE N'EST PAS UN CATALOGUE VIDE.
		 *
		 * Rendre `ok` avec zéro référence et `complete` à vrai autoriserait
		 * `Importer` à dépublier toute la boutique parce que personne n'a
		 * encore lancé la synchronisation. C'est la forme que prend ici la
		 * règle « rien trouvé et rien regardé sont deux résultats différents ».
		 */
		if ( array() === $refs ) {
			return array(
				'ok'       => false,
				'refs'     => array(),
				'complete' => false,
				'error'    => 'Le dépôt du catalogue est vide. Lancez « wp teeshoop catalogue synchroniser » avant d’importer.',
			);
		}

		return array(
			'ok'       => true,
			'refs'     => $refs,
			/*
			 * COMPLET SEULEMENT SI LA DERNIÈRE MARCHE L'ÉTAIT, et on ne le
			 * déduit pas de la table : on le lit dans l'option que `sync()`
			 * pose. Une table pleine peut être le reste d'une marche coupée.
			 */
			'complete' => 0 === $want && (bool) get_option( 'teeshoop_supply_complete', false ),
			'calls'    => 0,
			'seconds'  => round( microtime( true ) - $start, 3 ),
		);
	}

	/**
	 * Une référence, prête pour `Catalogue::map()`.
	 *
	 * Le produit vient du dépôt ; le prix et le stock viennent du service en
	 * direct, parce que ce sont les deux seules valeurs qu'un dépôt d'hier
	 * ferait mentir.
	 *
	 * @return array{ok:bool,entry?:array<string,mixed>,error?:string}
	 */
	public static function entry( string $ref ): array {
		$illisible = false;
		$product   = self::raw( $ref, $illisible );
		if ( null === $product ) {
			return array(
				'ok'    => false,
				'error' => $illisible
					? 'La charge utile déposée pour « ' . $ref . ' » est illisible. Relancer la synchronisation ne la réparera pas si elle a été écrite corrompue : purgez cette ligne du dépôt.'
					: 'La référence « ' . $ref . ' » n’est pas dans le dépôt du catalogue.',
			);
		}

		$live = Disponibilite::for_reference( $ref );

		return array(
			'ok'    => true,
			'entry' => self::to_entry( $product, $live ),
		);
	}

	/**
	 * La charge utile déposée pour une référence, décompressée.
	 *
	 * @return array<string,mixed>|null
	 */
	public static function raw( string $ref, ?bool &$illisible = null ): ?array {
		$illisible = false;
		global $wpdb;

		$blob = $wpdb->get_var(
			$wpdb->prepare( 'SELECT payload FROM `' . self::table() . '` WHERE ref = %s', $ref )
		);
		if ( ! is_string( $blob ) || '' === $blob ) {
			return null;
		}

		/*
		 * « ILLISIBLE » N'EST PAS « ABSENT », et l'appelant doit pouvoir le dire.
		 * `entry()` annonçait « la référence n'est pas dans le dépôt » sur une
		 * charge utile corrompue, ce qui envoie l'exploitant relancer une
		 * synchronisation qui ne réparera rien. Le drapeau est posé pour que le
		 * message soit juste ; le retour reste `null` dans les deux cas, donc
		 * aucun appelant n'a à changer.
		 */
		$json = @gzuncompress( $blob );
		if ( false === $json ) {
			$illisible = true;
			return null;
		}

		$product = json_decode( $json, true );
		if ( ! is_array( $product ) ) {
			$illisible = true;
			return null;
		}
		return $product;
	}

	// -----------------------------------------------------------------------
	// La cartographie, pure et testable
	// -----------------------------------------------------------------------

	/**
	 * Un produit du fournisseur vers la forme que `Catalogue::map()` lit.
	 *
	 * PURE : aucune fonction WordPress, aucun accès réseau, aucun `$wpdb`. Tout
	 * ce qui décide d'un prix ou d'une taille est donc testable par
	 * `tests/run.php` sans WordPress, ce qui est la règle de ce greffon et la
	 * raison pour laquelle `Pricing` n'a jamais eu de régression silencieuse.
	 *
	 * @param array<string,mixed>                    $product Le produit brut.
	 * @param array{ok:bool,rows:array<string,array<string,mixed>>,error:string} $live Prix et stock en direct.
	 * @return array<string,mixed>
	 */
	public static function to_entry( array $product, array $live ): array {
		$ref     = self::text( $product['reference'] ?? '' );
		$brand   = self::text( ( $product['brands'] ?? array() )['name'] ?? '' );
		$facts   = self::classify( $product );
		$variants = is_array( $product['variants'] ?? null ) ? $product['variants'] : array();

		$colourways = array();
		$skus       = array();
		$sizes      = array();
		$name       = '';
		$long       = '';
		$material   = '';
		$gsm        = null;
		$certs      = array();
		$updated    = self::text( $product['updatedAt'] ?? '' );

		foreach ( $variants as $v ) {
			if ( ! is_array( $v ) ) {
				continue;
			}
			$code = self::text( $v['variantReference'] ?? '' );
			if ( '' === $code ) {
				continue;
			}
			/*
			 * UN ARTICLE RETIRÉ OU EN CONSTRUCTION N'EST PAS VENDABLE, et ce
			 * n'est pas la même chose qu'un article en rupture. Le premier ne
			 * doit jamais apparaître ; le second apparaît avec zéro en stock.
			 */
			if ( ! empty( $v['deletedAt'] ) || ! empty( $v['underConstruction'] ) ) {
				continue;
			}

			$attrs  = self::attributes_of( $v );
			$colour = $attrs['colour'];
			$size   = $attrs['size'];
			if ( '' === $colour || '' === $size ) {
				continue;
			}

			if ( '' === $name ) {
				$name     = self::fr( $v['title'] ?? array() );
				$long     = self::fr( $v['longTitle'] ?? array() );
				$material = $attrs['material'];
				$g        = ( $v['grammage'] ?? array() )['value'] ?? null;
				$gsm      = is_numeric( $g ) && (float) $g > 0 ? (int) round( (float) $g ) : null;
				foreach ( (array) ( ( $v['certifications'] ?? array() )['certifications'] ?? array() ) as $c ) {
					$certs[] = self::text( $c );
				}
			}

			$ccode = self::colour_code( $colour );
			if ( ! isset( $colourways[ $ccode ] ) ) {
				$colourways[ $ccode ] = array(
					'code'   => $ccode,
					'name'   => $colour,
					/*
					 * LA PASTILLE EST UNE IMAGE, ET CE SERVICE N'EN PUBLIE
					 * AUCUNE. Le champ reste dans la forme parce que 46 572
					 * déclinaisons importées avant le 9 septembre 2026 en
					 * portent une et que `Colours` sait encore les mesurer ;
					 * il sort vide d'ici plutôt que de porter un nombre, qui
					 * n'est pas une image.
					 */
					'swatch' => '',
					/*
					 * LA TEINTE N'EST PUBLIÉE QUE SI ELLE EST DÉCLARÉE.
					 *
					 * Mesuré sur 75 088 déclinaisons : 14 568 portent un
					 * hexadécimal (19 %), 55 664 n'ont que du CMJN. Et 63 noms
					 * de couleur portent PLUSIEURS hexadécimaux différents
					 * selon le fabricant (« BLACK » en a six). Une table
					 * nom vers teinte serait donc fausse par construction.
					 *
					 * On rend ici la teinte déclarée quand elle existe, et rien
					 * quand elle n'existe pas : `Colours` mesure alors la
					 * photographie de CE coloris, ce qu'il sait déjà faire.
					 * Peindre du gris sous un vrai nom de couleur est exactement
					 * le défaut que `Product::blank_palette_of` refuse.
					 *
					 * LE CMJN N'EST PAS UNE ROUTE, même à 99,98 % de couverture :
					 * sans profil ICC les quatre nombres ne nomment aucune
					 * couleur, et toute conversion serait une invention à l'air
					 * plausible. Le raisonnement complet est en tête de
					 * `Swatch.php`, et la question est posée à l'associé (Q71).
					 */
					'hex'    => $attrs['hex'],
					'photo'  => '',
				);
			}
			if ( '' === $colourways[ $ccode ]['hex'] && '' !== $attrs['hex'] ) {
				$colourways[ $ccode ]['hex'] = $attrs['hex'];
			}

			/*
			 * LES URL SONT RÉÉCRITES ICI, UNE FOIS, ET PAS AU MOMENT DE LIRE.
			 *
			 * Le service publie ses photographies sur un hôte qui répond 404 :
			 * huit URL tirées au sort le 9 septembre 2026, huit 404. Les mêmes
			 * chemins répondent 200 avec un JPEG de 1,6 Mo sur l'hôte public.
			 * `SupplyHttp::media_url()` porte la correction et la raison ; si
			 * elle n'était appliquée qu'au moment de télécharger, la même URL
			 * serait stockée fausse dans la base et vraie dans le téléchargeur,
			 * et un lecteur sur deux se tromperait.
			 */
			$photos = self::photos_of( $v );
			if ( '' === $colourways[ $ccode ]['photo'] && '' !== $photos['front'] ) {
				$colourways[ $ccode ]['photo'] = SupplyHttp::media_url( $photos['front'] );
			}

			$row  = $live['rows'][ $code ] ?? null;
			$size_key = self::size_key( $size );
			$sizes[ $size_key ] = $size;

			$skus[] = array(
				'sku'        => $code,
				'colourCode' => $ccode,
				'sizeName'   => $size,
				'sizeOrder'  => Catalogue::size_rank( $size ),
				'ean'        => self::ean( $v['eanUpcCode'] ?? '' ),
				'weightKg'   => self::weight_kg( $v ),
				'coo'        => self::country( $v ),
				'closeout'   => self::has_tag( $v, 'FIN DE SERIE' ),
				'isNew'      => self::has_tag( $v, 'NOUVEAU' ),
				'front'      => SupplyHttp::media_url( $photos['front'] ),
				'back'       => SupplyHttp::media_url( $photos['back'] ),
			);
		}

		// -------------------------------------------------------------------
		// Prix et stock : deux champs nuls avec un motif, jamais un tableau vide
		// -------------------------------------------------------------------

		$prices       = null;
		$price_error  = '';
		$stock        = null;
		$stock_error  = '';

		if ( ! $live['ok'] ) {
			/*
			 * « NOUS N'AVONS PAS PU DEMANDER » N'EST PAS « IL N'Y EN A PAS ».
			 *
			 * `Catalogue::map()` lit ces deux champs pour décider s'il a le
			 * droit de toucher au prix d'achat et au stock déjà en base. Un
			 * tableau vide sans motif lui ferait effacer le coût de 366
			 * déclinaisons, ce que son propre commentaire raconte comme
			 * l'ayant déjà fait une fois.
			 */
			$price_error = 'upstream';
			$stock_error = 'upstream';
		} else {
			$prices = array();
			$stock  = array();
			foreach ( $skus as $s ) {
				$row = $live['rows'][ $s['sku'] ] ?? null;
				if ( ! is_array( $row ) ) {
					continue;
				}
				if ( null !== $row['cents'] ) {
					$prices[ $s['sku'] ] = array(
						// `cost` est notre prix d'achat, en euros, hors taxes.
						// `Catalogue::variations()` le repasse en centiemes par
						// `Money::from_eur`, qui est la seule conversion.
						'cost' => $row['cents'] / 100,
						/*
						 * `list` RESTE NUL, ET C'EST UNE DÉCISION.
						 *
						 * Le service publie un `publicPrice` que son nom
						 * présente comme un tarif public. Mesuré : 3 quand
						 * notre prix d'achat est 4 sur la même référence, donc
						 * sous notre coût. L'afficher comme prix barré serait
						 * un prix de référence fictif, interdit en France
						 * (article L. 112-1-1 du code de la consommation).
						 */
						'list' => null,
					);
				}
				if ( null !== $row['stock'] ) {
					/*
					 * LES DEUX NOMBRES SONT ENFIN NOMMÉS.
					 *
					 * L'ancien flux en donnait trois sans les nommer, et la
					 * question 43 demandait au fournisseur ce qu'étaient les
					 * deux autres. Celui-ci les nomme : `stock` est ce que le
					 * grossiste a sur ses propres étagères, `stock_supplier`
					 * ce que le fabricant a derrière lui. On ne vend que
					 * contre le premier. Le second est un signal de
					 * réapprovisionnement, jamais une disponibilité.
					 */
					$stock[ $s['sku'] ] = array( max( 0, (int) $row['stock'] ), 0, max( 0, (int) ( $row['stock_supplier'] ?? 0 ) ) );
				}
			}
		}

		$first = self::first_photo( $skus );

		return array(
			'style'       => array(
				'styleNr'     => $ref,
				'brand'       => $brand,
				/*
				 * LE CODE DU FABRICANT, ET C'EST LE TITRE COURT.
				 *
				 * Vérifié sur BC01B : `title.fr` vaut « #INSPIRE E150 », qui
				 * est le nom de modèle de B&C, celui qu'un acheteur tape. La
				 * référence du grossiste (`BC01B`) est le PRÉFIXE de chaque
				 * numéro d'article (`BC01BSML`), donc la publier rendrait la
				 * clé d'approvisionnement que `Shelf` scelle. C'est exactement
				 * la fuite que `Catalogue::public_ref()` raconte avoir déjà
				 * coûté une fois.
				 */
				/*
				 * LA MARQUE EN SECOURS, JAMAIS LA RÉFÉRENCE DU GROSSISTE.
				 *
				 * Ce champ devient la référence PUBLIQUE, et il retombait sur
				 * `$ref`, qui est le préfixe de chaque numéro d'article : le
				 * publier rend la clé d'approvisionnement que `Shelf::SEALED`
				 * existe pour cacher. Mesuré : zéro des 3 241 produits n'est
				 * sans titre fabricant aujourd'hui, donc ce repli ne s'est
				 * jamais déclenché. Il est fermé quand même, parce qu'un jour
				 * où il se déclenche est un jour où personne ne regarde.
				 */
				'supplierRef' => '' !== $name ? $name : $brand,
				'name'        => '' !== $long ? $long : $name,
				'description' => self::description( $long, $material, $gsm ),
				'kind'        => $facts['kind'],
				'shelf'       => $facts['shelf'],
				'sleeve'      => $facts['sleeve'],
				'certificates' => array_values( array_unique( array_filter( $certs ) ) ),
				'colourways'  => array_values( $colourways ),
				'skus'        => $skus,
				'sizes'       => array_values( $sizes ),
				'front'       => $first['front'],
				'back'        => $first['back'],
				'hasBack'     => '' !== $first['back'],
				/*
				 * AUCUNE FICHE TECHNIQUE N'EST PUBLIÉE, ET C'EST MESURÉ.
				 *
				 * Le service publie des PDF (type 30) sur 1 173 des 3 241
				 * produits, nommés `{REF}.pdf`, `{REF}_SP.pdf`, `{REF}_EN.pdf`,
				 * `{REF}_DE.pdf`. Deux raisons de n'en publier aucun, et la
				 * seconde suffirait seule :
				 *
				 *   ILS NE RÉPONDENT PAS. Essayés le 9 septembre 2026 sur les
				 *   deux hôtes connus : 404 des deux côtés. Publier le lien
				 *   donnerait au client un lien mort sur une fiche produit.
				 *
				 *   ET CE SONT LES DOCUMENTS DU GROSSISTE. Ils portent sa
				 *   marque, ses coordonnées, et le suffixe `_SP` (« sans prix »)
				 *   sur la moitié d'entre eux dit assez clairement que ceux qui
				 *   ne le portent pas en ont. Notre tarif d'achat sur une fiche
				 *   produit est exactement ce que `Shelf::SEALED` et
				 *   `scripts/php-guard.mjs` existent pour empêcher, et un PDF
				 *   n'est pas moins public parce qu'il faut cliquer.
				 *
				 * CE QUE ÇA COÛTE, dit plutôt que caché : le service ne publie
				 * AUCUNE mesure de vêtement (relevé sur toutes les clés de
				 * toutes les déclinaisons : ni demi-poitrine, ni longueur ; les
				 * seules dimensions sont celles du carton). La fiche du
				 * fabricant que `Design::unprintable_sizes` consulte pour
				 * refuser une taille qu'un film ne peut pas porter n'a donc
				 * toujours pas de source automatique, et `scripts/zones-mesurer.mjs`
				 * reste le seul moyen de la remplir. Le champ
				 * `SizeSource = 'reference-chart'` du studio garde donc sa
				 * raison d'être, contrairement à ce qu'on pouvait espérer.
				 */
				'sizespecPdf' => '',
				'exportedAt'  => $updated,
			),
			'prices'      => null === $prices ? null : array(
				'currency' => 'EUR',
				'prices'   => $prices,
			),
			'pricesError' => $price_error,
			'stock'       => null === $stock ? null : array(
				/*
				 * L'HORODATAGE EST LE NÔTRE, ET IL EST HONNÊTE.
				 *
				 * L'ancien service publiait le sien en tête de son fichier de
				 * stock. Celui-ci ne le fait pas sur la route en direct : la
				 * réponse est calculée à la demande, donc l'instant de la
				 * demande EST l'instant de l'observation. Ce qu'il ne faut pas
				 * faire, et que le flux en masse invite à faire, c'est reprendre
				 * son `updatedAt` : mesuré à quatre mois en préproduction.
				 */
				'at'    => gmdate( 'c' ),
				'stock' => $stock,
			),
			'stockError'  => $stock_error,
		);
	}

	// -----------------------------------------------------------------------
	// Classement : deux questions, deux règles
	// -----------------------------------------------------------------------

	/**
	 * Les mots du fournisseur qui décident du VÊTEMENT, donc du prix.
	 *
	 * `kind` atteint le moteur de coût puis les sélecteurs des règles de prix :
	 * une valeur inventée ici est une valeur qu'aucune règle de marge ne
	 * connaît, et une vente passe alors de « vendable » à « sous le plancher ».
	 * La table est donc fermée sur les cinq que `Catalogue::CATEGORIES` porte.
	 */
	private const KIND_WORDS = array(
		'tee'   => array( 'TEE SHIRT', 'TEE-SHIRT', 'TEESHIRT', 'T SHIRT', 'DEBARDEUR', 'DOS NAGEUR' ),
		'polo'  => array( 'POLO' ),
		'sweat' => array( 'SWEAT SHIRT', 'SWEAT-SHIRT', 'SWEATSHIRT', 'SWEAT CAPUCHE', 'SWEAT ZIPPE CAPUCHE', 'SWEAT ZIPPE', 'SWEAT COL ZIPPE', 'CAPUCHE', 'HOODIE' ),
		'shirt' => array( 'CHEMISE', 'CHEMISETTE', 'POPELINE', 'OXFORD' ),
	);

	/**
	 * Ce qui n'est pas un vêtement à imprimer, quoi que dise le reste.
	 *
	 * Un sac de sport est rangé sous « SPORT » comme un t-shirt de sport, et un
	 * tablier de cuisine porte « TENUE PROFESSIONNELLE » comme une veste. Le
	 * veto passe d'abord parce qu'un mot juste dans une mauvaise catégorie
	 * mettrait un sac dans le rayon T-Shirts, et surtout lui donnerait le
	 * `kind` d'un t-shirt, donc son prix plancher.
	 */
	private const KIND_VETO = array(
		'BAGAGERIE', 'SAC', 'SAC A DOS', 'SAC À DOS', 'SAC SHOPPING', 'SAC DE SPORT', 'SAC DE VOYAGE',
		'SAC BANDOULIERE', 'SAC CORDON', 'SAC GYM', 'GYM SAC', 'SAC BANANE', 'SAC ISOTHERME',
		'SAC TOILE JUTE', 'SAC TOILE DE JUTE', 'SAC ORGANIQUE', 'SAC IMPERMEABLE', 'SAC A ROULETTES',
		'SAC A CHAUSSURES', 'SAC - POCHETTE ORDINATEUR', 'POCHETTE', 'TROUSSE', 'PORTEFEUILLE',
		'CHAUSSURES', 'CHAUSSETTES', 'CEINTURE', 'BRETELLES', 'CRAVATE - NŒUD', 'PARAPLUIE',
		'PORTE-CLE', 'ORGANISER', 'BANDANA', 'ECHARPE', 'GANTS', 'FOULARD',
		'LINGE DE MAISON', 'SERVIETTE', 'SERVIETTES', 'TORCHON', 'PLAID', 'COUVERTURE',
		'HOUSSE COUSSIN', 'PEIGNOIR', 'MASQUE', 'MASQUES', 'EPONGE',
		'SOUS-VETEMENTS', 'SLIP - BOXER', 'BRASSIERE', 'PYJAMA', 'BODY',
		'CASQUETTE', 'BONNET', 'CHAPEAU', 'TOQUE', 'TABLIER', 'CHASUBLE',
		/*
		 * ─────────────────────────────────────────────────────────────────────
		 * ET LE VÊTEMENT D'EXTÉRIEUR, QUI SE VENDAIT EN SWEAT.
		 *
		 * « CAPUCHE » est dans les mots du sweat, et une veste softshell à
		 * capuche le porte aussi. `SOFTSHELL` n'existait que dans les mots du
		 * RAYON, qui décide où l'on range et pas ce qu'on facture. Relevé sur le
		 * dépôt le 9 septembre 2026 : 32 références rangées en veste avec un
		 * `kind` de sweat, dont BC650 et BC660, « Veste Softshell homme à
		 * capuche », entrées dans la gamme à 63,00 EUR au tarif du sweat.
		 *
		 * Ce que cela produit : le studio dessine un aperçu de sweat par-dessus
		 * une veste trois couches, et place le visuel là où il y a une
		 * fermeture éclair sur toute la hauteur du devant.
		 *
		 * `Catalogue.php` et le registre affirmaient tous les deux que « le
		 * classificateur du Worker refuse le softshell ». Le Worker n'est plus
		 * sur ce chemin, et la garde du registre ne pouvait pas le voir : son
		 * ancre pointe sur du code mort, et une ancre morte dégrade en silence.
		 */
		'SOFTSHELL', 'VESTE', 'VESTE BLOUSON', 'BLOUSON', 'PARKA', 'DOUDOUNE',
		'BODYWARMER', 'COUPE VENT', 'POLAIRE', 'MICROPOLAIRE', 'MATELASSE',
		'BOMBER', 'GILET', 'GILET SECURITE', 'CARDIGAN', '3 EN 1', '7 EN 1',
		'GRENOUILLERE', 'COMBINAISON', 'PEIGNOIR',
	);

	/** Le rayon, qui ne décide d'aucun montant. */
	private const SHELF_WORDS = array(
		'sac'       => array( 'BAGAGERIE', 'SAC', 'SAC A DOS', 'SAC À DOS', 'SAC SHOPPING', 'SAC DE SPORT', 'SAC DE VOYAGE', 'SAC BANDOULIERE', 'SAC CORDON', 'SAC GYM', 'GYM SAC', 'SAC BANANE', 'SAC ISOTHERME', 'SAC TOILE JUTE', 'SAC TOILE DE JUTE', 'SAC ORGANIQUE', 'SAC IMPERMEABLE', 'SAC A ROULETTES', 'SAC A CHAUSSURES', 'SAC - POCHETTE ORDINATEUR', 'POCHETTE', 'TROUSSE' ),
		'casquette' => array( 'CASQUETTE', 'VISIERE INCURVEE', 'VISIERE PLATE', 'TRUCKER', 'SNAPBACK', '5 PANS', '6 PANS', 'BASEBALL', 'RAPPER', 'CHAPEAU' ),
		'bonnet'    => array( 'BONNET', 'POMPON', 'TOQUE', 'ACCESSOIRES HIVER' ),
		'tablier'   => array( 'TABLIER', 'CHASUBLE', 'TENUE DE CUISINE', 'VESTE CUISINE' ),
		'maison'    => array( 'LINGE DE MAISON', 'SERVIETTE', 'SERVIETTES', 'TORCHON', 'PLAID', 'COUVERTURE', 'HOUSSE COUSSIN', 'EPONGE', 'PEIGNOIR' ),
		'chemise'   => array( 'CHEMISE', 'CHEMISETTE', 'POPELINE', 'OXFORD', 'BLOUSE', 'TUNIQUE' ),
		'veste'     => array( 'VESTE', 'VESTE - BLOUSON', 'VESTE-BLOUSON', 'BLOUSON', 'PARKA', 'DOUDOUNE', 'BODYWARMER', 'SOFTSHELL', 'COUPE-VENT', 'POLAIRE', 'MICROPOLAIRE', 'MATELASSE', 'BOMBER', 'GILET', 'GILET SECURITE', 'GILET SÉCURITÉ', '3 EN 1', '7 EN 1', 'CARDIGAN' ),
		'sweat'     => array( 'SWEAT SHIRT', 'SWEAT-SHIRT', 'SWEATSHIRT', 'SWEAT CAPUCHE', 'SWEAT ZIPPE CAPUCHE', 'SWEAT ZIPPE', 'SWEAT COL ZIPPE', 'CAPUCHE', 'PULL', 'FRENCH TERRY' ),
		'polo'      => array( 'POLO' ),
		'tshirt'    => array( 'TEE SHIRT', 'TEE-SHIRT', 'TEESHIRT', 'T SHIRT', 'DEBARDEUR', 'DOS NAGEUR', 'OVERSIZE' ),
	);

	/** Les manches, quand le fournisseur le dit. Sinon `unknown`, jamais `short`. */
	private const SLEEVE_WORDS = array(
		'long'       => array( 'MANCHES LONGUES', 'MANCHES RAGLAN' ),
		'sleeveless' => array( 'DEBARDEUR', 'DOS NAGEUR', 'BODYWARMER', 'GILET' ),
	);

	/**
	 * Le vêtement, le rayon et les manches, lus dans les mots du fournisseur.
	 *
	 * @param array<string,mixed> $product
	 * @return array{kind:string,shelf:string,sleeve:string}
	 */
	public static function classify( array $product ): array {
		$words = self::words_of( $product );

		$kind = 'other';
		if ( ! self::any( $words, self::KIND_VETO ) ) {
			foreach ( self::KIND_WORDS as $candidate => $needles ) {
				if ( self::any( $words, $needles ) ) {
					$kind = $candidate;
					break;
				}
			}
		}

		/*
		 * L'ORDRE DE `SHELF_WORDS` EST LA RÈGLE : le plus spécifique d'abord.
		 * Un « SWEAT ZIPPÉ CAPUCHE » porte aussi « ZIPPÉE », et une veste
		 * polaire porte « POLAIRE » et « VESTE ». Le premier qui répond gagne,
		 * et la table est ordonnée pour que ce soit le bon.
		 */
		$shelf = 'autre';
		foreach ( self::SHELF_WORDS as $candidate => $needles ) {
			if ( self::any( $words, $needles ) ) {
				$shelf = $candidate;
				break;
			}
		}

		$sleeve = 'unknown';
		foreach ( self::SLEEVE_WORDS as $candidate => $needles ) {
			if ( self::any( $words, $needles ) ) {
				$sleeve = $candidate;
				break;
			}
		}
		/*
		 * UN T-SHIRT OU UN POLO SANS MENTION EST À MANCHES COURTES, et c'est
		 * une déduction, pas une invention : le fournisseur range les manches
		 * longues sous « MANCHES LONGUES » et ne range rien sous « manches
		 * courtes ». L'absence est donc porteuse pour ces deux familles-là, et
		 * pour elles seules. Un sweat sans mention reste `unknown`, parce que
		 * 167 sweats sur 168 sont à manches longues et que l'absence n'y dit
		 * rien.
		 */
		if ( 'unknown' === $sleeve && in_array( $kind, array( 'tee', 'polo' ), true ) ) {
			$sleeve = 'short';
		}

		return array(
			'kind'   => $kind,
			'shelf'  => $shelf,
			'sleeve' => $sleeve,
		);
	}

	/**
	 * Tous les mots de classement d'un produit, normalisés.
	 *
	 * NORMALISÉS PARCE QUE LE VOCABULAIRE NE L'EST PAS. Relevé sur le catalogue
	 * entier : « RECYCLÉ » et « RECYCLE », « HAUTE VISIBILITE » et
	 * « HAUTE-VISIBILITÉ », « SWEAT ZIPPÉ CAPUCHE » et « SWEAT ZIPPE CAPUCHE »
	 * coexistent. Comparer les chaînes telles quelles range le même vêtement
	 * dans deux rayons selon la déclinaison qu'on regarde.
	 *
	 * @param array<string,mixed> $product
	 * @return string[]
	 */
	private static function words_of( array $product ): array {
		$out = array();
		foreach ( (array) ( $product['variants'] ?? array() ) as $v ) {
			if ( ! is_array( $v ) ) {
				continue;
			}
			foreach ( (array) ( $v['categories'] ?? array() ) as $c ) {
				if ( ! is_array( $c ) ) {
					continue;
				}
				$out[] = self::fold( self::fr( $c['categories'] ?? array() ) );
				$out[] = self::fold( self::fr( $c['families'] ?? array() ) );
			}
		}
		return array_values( array_unique( array_filter( $out ) ) );
	}

	/**
	 * Majuscules, sans accent, séparateurs réduits à l'espace.
	 *
	 * `iconv` n'est pas garanti sur un hébergement mutualisé et
	 * `Normalizer` demande intl ; la table couvre le français et les quelques
	 * mots anglais du vocabulaire, et elle ne dépend d'aucune extension.
	 */
	public static function fold( string $s ): string {
		$s = strtr(
			$s,
			array(
				'à' => 'a', 'â' => 'a', 'ä' => 'a', 'á' => 'a', 'ã' => 'a', 'å' => 'a',
				'ç' => 'c',
				'è' => 'e', 'é' => 'e', 'ê' => 'e', 'ë' => 'e',
				'ì' => 'i', 'í' => 'i', 'î' => 'i', 'ï' => 'i',
				'ñ' => 'n',
				'ò' => 'o', 'ó' => 'o', 'ô' => 'o', 'ö' => 'o', 'õ' => 'o',
				'ù' => 'u', 'ú' => 'u', 'û' => 'u', 'ü' => 'u',
				'ý' => 'y', 'ÿ' => 'y',
				'œ' => 'oe', 'æ' => 'ae',
			)
		);
		$s = strtoupper( $s );
		$s = strtr(
			$s,
			array(
				'À' => 'A', 'Â' => 'A', 'Ä' => 'A', 'Á' => 'A', 'Ã' => 'A', 'Å' => 'A',
				'Ç' => 'C',
				'È' => 'E', 'É' => 'E', 'Ê' => 'E', 'Ë' => 'E',
				'Ì' => 'I', 'Í' => 'I', 'Î' => 'I', 'Ï' => 'I',
				'Ñ' => 'N',
				'Ò' => 'O', 'Ó' => 'O', 'Ô' => 'O', 'Ö' => 'O', 'Õ' => 'O',
				'Ù' => 'U', 'Ú' => 'U', 'Û' => 'U', 'Ü' => 'U',
				'Ý' => 'Y',
				'Œ' => 'OE', 'Æ' => 'AE',
			)
		);
		$s = preg_replace( '/[^A-Z0-9]+/', ' ', $s ) ?? '';
		return trim( $s );
	}

	/**
	 * Un des mots recherchés est-il un des mots du produit, mot entier.
	 *
	 * ÉGALITÉ ET PAS SOUS-CHAÎNE. « SAC » en sous-chaîne attrape « SAC A DOS »
	 * (voulu) mais aussi n'importe quel mot qui le contient, et c'est ainsi
	 * qu'un classement se met à ranger au hasard six mois après avoir été écrit.
	 *
	 * @param string[] $words
	 * @param string[] $needles
	 */
	private static function any( array $words, array $needles ): bool {
		$folded = array();
		foreach ( $needles as $n ) {
			$folded[ self::fold( $n ) ] = true;
		}
		foreach ( $words as $w ) {
			if ( isset( $folded[ $w ] ) ) {
				return true;
			}
		}
		return false;
	}

	// -----------------------------------------------------------------------
	// Lecture d'une déclinaison
	// -----------------------------------------------------------------------

	/**
	 * Couleur, taille, matière et teinte déclarée d'une déclinaison.
	 *
	 * @param array<string,mixed> $variant
	 * @return array{colour:string,size:string,material:string,hex:string}
	 */
	private static function attributes_of( array $variant ): array {
		$out = array(
			'colour'   => '',
			'size'     => '',
			'material' => '',
			'hex'      => '',
		);

		foreach ( (array) ( $variant['attributes'] ?? array() ) as $a ) {
			if ( ! is_array( $a ) ) {
				continue;
			}
			$type = self::text( $a['type'] ?? '' );
			if ( 'color' === $type ) {
				$out['colour'] = self::text( $a['value'] ?? '' );
				$out['hex']    = self::hex( self::text( $a['hex'] ?? '' ) );
			} elseif ( 'sizes' === $type ) {
				$out['size'] = self::text( $a['value'] ?? '' );
			} elseif ( 'material' === $type ) {
				$out['material'] = is_array( $a['value'] ?? null ) ? self::fr( $a['value'] ) : self::text( $a['value'] ?? '' );
			}
		}

		return $out;
	}

	/**
	 * Un hexadécimal à six chiffres avec son croisillon, ou ''.
	 *
	 * Le service publie « #eb5d0f » sur certaines lignes et « FFFFFF » sur
	 * d'autres. Une seule forme sort d'ici, et tout le reste sort vide plutôt
	 * que réparé au jugé : `Product::blank_palette_of` laisse tomber une
	 * pastille sans couleur mesurée, ce qui est le comportement voulu.
	 */
	public static function hex( string $raw ): string {
		$raw = trim( $raw );
		if ( '' === $raw ) {
			return '';
		}
		if ( 1 === preg_match( '/^#?([0-9a-fA-F]{6})$/', $raw, $m ) ) {
			return '#' . strtolower( $m[1] );
		}
		return '';
	}

	/**
	 * Les photographies d'une déclinaison, par vue.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * IL Y EN A UNE PAR COLORIS, ET C'EST NOUVEAU.
	 *
	 * Mesuré sur 154 produits multicolores : 154 publient un jeu d'images
	 * DIFFÉRENT par coloris, zéro partagent le même. L'ancien fournisseur
	 * donnait une seule photographie pour 54 coloris, ce que `Editeur::couleurs`
	 * raconte et compense par une légende. Cette légende n'a plus lieu d'être.
	 *
	 * Les vues sont dans le nom du fichier : FRONT 16 194, BACK 12 134,
	 * LEFTSIDE 6 962, RIGHTSIDE 3 023, plus une poignée de variantes
	 * (FRONT1, FONT, RIGTHSIDE) qui sont des fautes de frappe du fournisseur et
	 * qu'on rattache plutôt que d'ignorer.
	 *
	 * @param array<string,mixed> $variant
	 * @return array{front:string,back:string}
	 */
	private static function photos_of( array $variant ): array {
		$front = '';
		$back  = '';
		foreach ( (array) ( $variant['images'] ?? array() ) as $im ) {
			if ( ! is_array( $im ) ) {
				continue;
			}
			$url = self::text( $im['url'] ?? '' );
			if ( '' === $url ) {
				continue;
			}
			$view = self::view_of( self::text( $im['name'] ?? '' ) );
			if ( 'front' === $view && '' === $front ) {
				$front = $url;
			} elseif ( 'back' === $view && '' === $back ) {
				$back = $url;
			}
		}
		return array(
			'front' => $front,
			'back'  => $back,
		);
	}

	/** La vue qu'un nom de fichier annonce : `front`, `back`, `side` ou ''. */
	public static function view_of( string $name ): string {
		$base = self::fold( preg_replace( '/\.[a-zA-Z0-9]+$/', '', $name ) ?? '' );
		if ( '' === $base ) {
			return '';
		}
		$parts = explode( ' ', $base );
		$last  = (string) end( $parts );
		// FONT et RIGTHSIDE sont deux fautes de frappe du fournisseur, comptées
		// (1 et 1) plutôt que devinées : elles sont dans le relevé du 9/09/2026.
		if ( 1 === preg_match( '/^(FRONT|FONT)[0-9A-Z]*$/', $last ) ) {
			return 'front';
		}
		if ( 1 === preg_match( '/^BACK[0-9A-Z]*$/', $last ) ) {
			return 'back';
		}
		if ( 1 === preg_match( '/^(LEFTSIDE|RIGHTSIDE|RIGTHSIDE)$/', $last ) ) {
			return 'side';
		}
		return '';
	}

	/**
	 * La première photographie de face et de dos du produit entier.
	 *
	 * @param array<int,array<string,mixed>> $skus
	 * @return array{front:string,back:string}
	 */
	private static function first_photo( array $skus ): array {
		$front = '';
		$back  = '';
		foreach ( $skus as $s ) {
			if ( '' === $front && '' !== (string) ( $s['front'] ?? '' ) ) {
				$front = (string) $s['front'];
			}
			if ( '' === $back && '' !== (string) ( $s['back'] ?? '' ) ) {
				$back = (string) $s['back'];
			}
			if ( '' !== $front && '' !== $back ) {
				break;
			}
		}
		return array(
			'front' => $front,
			'back'  => $back,
		);
	}

	// -----------------------------------------------------------------------
	// Petits lecteurs
	// -----------------------------------------------------------------------

	/**
	 * Le français d'un champ multilingue, ou la première langue qui parle.
	 *
	 * L'anglais en secours et jamais l'espagnol : relevé sur le catalogue,
	 * `es` porte parfois un autre produit (« KNIT BEANIE » quand `fr` dit
	 * « HEAVYWEIGHT BEANIE »), donc s'en servir mélangerait deux modèles.
	 *
	 * @param mixed $field
	 */
	private static function fr( $field ): string {
		if ( is_string( $field ) ) {
			return trim( $field );
		}
		if ( ! is_array( $field ) ) {
			return '';
		}
		foreach ( array( 'fr', 'en' ) as $lang ) {
			$v = $field[ $lang ] ?? null;
			if ( is_string( $v ) && '' !== trim( $v ) ) {
				return trim( $v );
			}
			if ( is_array( $v ) && isset( $v[0] ) && is_string( $v[0] ) && '' !== trim( $v[0] ) ) {
				return trim( $v[0] );
			}
		}
		return '';
	}

	/** @param mixed $v */
	private static function text( $v ): string {
		return is_scalar( $v ) ? trim( (string) $v ) : '';
	}

	/**
	 * La description, assemblée des champs structurés plutôt que d'une prose.
	 *
	 * L'ancien fournisseur noyait la composition et le grammage dans un
	 * paragraphe, et `Catalogue::composition()` les en extrayait par expression
	 * régulière. Celui-ci les publie comme des champs. Les extraire d'une
	 * phrase qu'on vient de composer soi-même serait recopier un problème
	 * résolu, donc la phrase est écrite POUR l'extracteur, avec les deux
	 * valeurs dans la forme exacte qu'il attend.
	 */
	private static function description( string $long, string $material, ?int $gsm ): string {
		$bits = array();
		if ( '' !== $long ) {
			$bits[] = rtrim( $long, ' .' ) . '.';
		}
		if ( '' !== $material ) {
			$bits[] = rtrim( $material, ' .' ) . '.';
		}
		if ( null !== $gsm && $gsm > 0 ) {
			$bits[] = $gsm . ' g/m².';
		}
		/*
		 * UN RETOUR À LA LIGNE ENTRE CHAQUE FAIT, ET C'EST LA CORRECTION D'UN
		 * DÉFAUT VISIBLE SUR UNE FICHE PRODUIT.
		 *
		 * `Catalogue::composition()` cherche la LIGNE qui porte un pourcentage,
		 * parce que l'ancien fournisseur écrivait une liste à puces. En joignant
		 * par des espaces, tout tenait sur une ligne et l'extracteur rendait la
		 * phrase entière : la fiche BC03T affichait « Tee-shirt homme col rond
		 * 190. 100% coton pré-rétréci... » dans le champ Matière. Mesuré sur le
		 * miroir le 9 septembre 2026, après import réel.
		 *
		 * Écrire une ligne par fait vaut mieux que d'ajouter un chemin qui
		 * court-circuiterait l'extracteur : il y aurait alors deux façons de
		 * lire une composition, et le jour où l'une des deux se trompe, la
		 * fiche et l'export ne diraient pas la même chose.
		 */
		return implode( "\n", $bits );
	}

	/** Un code EAN à 8, 12, 13 ou 14 chiffres, ou ''. */
	private static function ean( $raw ): string {
		$raw = preg_replace( '/\D+/', '', self::text( $raw ) ) ?? '';
		return in_array( strlen( $raw ), array( 8, 12, 13, 14 ), true ) ? $raw : '';
	}

	/**
	 * Le poids unitaire en kilogrammes, ou null.
	 *
	 * `netWeight` d'abord, `averageWeight` en secours : relevé sur le catalogue,
	 * `averageWeight` vaut 0 sur des références où `netWeight` est renseigné, et
	 * zéro kilogramme est un poids que le transporteur refuse de croire.
	 *
	 * @param array<string,mixed> $variant
	 */
	private static function weight_kg( array $variant ): ?float {
		foreach ( array( 'netWeight', 'averageWeight' ) as $key ) {
			$v = ( $variant[ $key ] ?? array() )['value'] ?? null;
			if ( is_numeric( $v ) && (float) $v > 0 ) {
				return round( (float) $v, 4 );
			}
		}
		return null;
	}

	/**
	 * Le pays d'origine, en deux lettres.
	 *
	 * Le service publie un NOM en français (« Bangladesh », « Algérie »), pas un
	 * code. `Catalogue` attend l'ISO 3166-1 alpha-2, qui est ce que la douane
	 * lit. La table couvre les pays réellement présents dans ce catalogue ; un
	 * pays absent rend '' plutôt qu'un code approché, parce qu'une origine
	 * fausse sur un document douanier est pire qu'une origine absente.
	 *
	 * @param array<string,mixed> $variant
	 */
	private static function country( array $variant ): string {
		$names = (array) ( $variant['countryOfOrigin'] ?? array() );
		$name  = self::fold( self::text( $names[0] ?? '' ) );
		$map   = array(
			'BANGLADESH' => 'BD', 'CHINE' => 'CN', 'INDE' => 'IN', 'PAKISTAN' => 'PK',
			'TURQUIE' => 'TR', 'VIETNAM' => 'VN', 'VIET NAM' => 'VN', 'CAMBODGE' => 'KH',
			'ALGERIE' => 'DZ', 'MAROC' => 'MA', 'TUNISIE' => 'TN', 'EGYPTE' => 'EG',
			'PORTUGAL' => 'PT', 'ESPAGNE' => 'ES', 'ITALIE' => 'IT', 'FRANCE' => 'FR',
			'POLOGNE' => 'PL', 'ROUMANIE' => 'RO', 'BULGARIE' => 'BG', 'GRECE' => 'GR',
			'MADAGASCAR' => 'MG', 'MAURICE' => 'MU', 'ILE MAURICE' => 'MU',
			'INDONESIE' => 'ID', 'SRI LANKA' => 'LK', 'MYANMAR' => 'MM', 'BIRMANIE' => 'MM',
			'HAITI' => 'HT', 'HONDURAS' => 'HN', 'NICARAGUA' => 'NI', 'SALVADOR' => 'SV',
			'MEXIQUE' => 'MX', 'ETATS UNIS' => 'US', 'ROYAUME UNI' => 'GB',
			'ALLEMAGNE' => 'DE', 'BELGIQUE' => 'BE', 'PAYS BAS' => 'NL',
			'REPUBLIQUE TCHEQUE' => 'CZ', 'TCHEQUIE' => 'CZ', 'SLOVAQUIE' => 'SK',
			'MOLDAVIE' => 'MD', 'UKRAINE' => 'UA', 'SERBIE' => 'RS', 'MACEDOINE' => 'MK',
			'JORDANIE' => 'JO', 'ETHIOPIE' => 'ET', 'KENYA' => 'KE', 'LESOTHO' => 'LS',
		);
		return $map[ $name ] ?? '';
	}

	/**
	 * Une étiquette est-elle posée sur cette déclinaison.
	 *
	 * @param array<string,mixed> $variant
	 */
	private static function has_tag( array $variant, string $needle ): bool {
		$needle = self::fold( $needle );
		foreach ( (array) ( $variant['tags'] ?? array() ) as $t ) {
			if ( self::fold( self::text( $t ) ) === $needle ) {
				return true;
			}
		}
		foreach ( (array) ( $variant['categories'] ?? array() ) as $c ) {
			if ( is_array( $c ) && self::fold( self::fr( $c['categories'] ?? array() ) ) === $needle ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Le code interne d'un coloris, dérivé de son nom.
	 *
	 * Le service ne publie pas de code de coloris exploitable : `colorCode` est
	 * une FAMILLE (« BLUE » pour « ROYAL / ORANGE »), pas une identité. Le nom
	 * est donc la clé, réduite à ce qu'un identifiant supporte.
	 */
	public static function colour_code( string $name ): string {
		$code = self::fold( $name );
		$code = str_replace( ' ', '-', $code );
		return '' === $code ? 'sans-nom' : strtolower( $code );
	}

	/** La clé de déduplication d'une taille, insensible à la casse et aux espaces. */
	private static function size_key( string $size ): string {
		return self::fold( $size );
	}

	/**
	 * Une date du service vers le format que MySQL accepte, ou null.
	 *
	 * Le service écrit « 2024-11-25 16:36:00 ». Une chaîne vide ou illisible
	 * rend null plutôt que « 0000-00-00 », que MySQL en mode strict refuse et
	 * qui ferait échouer l'insertion de tout un lot pour une date manquante.
	 */
	private static function mysql_date( string $raw ): ?string {
		$raw = trim( $raw );
		if ( '' === $raw ) {
			return null;
		}
		$ts = strtotime( $raw );
		return false === $ts ? null : gmdate( 'Y-m-d H:i:s', $ts );
	}

	/** La date que les filtres du service attendent, `d-m-Y`. */
	public static function since_param( int $timestamp ): string {
		return gmdate( self::DATE_FMT, $timestamp );
	}

	// -----------------------------------------------------------------------
	// Stock en masse, livraisons, commande
	// -----------------------------------------------------------------------

	/**
	 * Une page du stock, pour le balayage périodique de `Purchase`.
	 *
	 * Lit le dépôt local des disponibilités plutôt que le service : le balayage
	 * couvre des dizaines de milliers d'articles et le service coûte 0,068 s par
	 * code. `Disponibilite::sweep()` est ce qui rafraîchit ce dépôt, dans son
	 * propre budget, et c'est le seul endroit qui parle au fournisseur pour ça.
	 *
	 * @return array{ok:bool,error?:string,at?:string,total?:int,rows?:array<array{0:string,1:int,2:int,3:int}>,next?:?int}
	 */
	public static function stock_page( int $offset, int $limit = 4000 ): array {
		return Disponibilite::stock_page( $offset, $limit );
	}

	/**
	 * Les réapprovisionnements annoncés.
	 *
	 * LE SERVICE N'EN PUBLIE PAS. L'ancien avait un point d'entrée qui donnait
	 * une date et une quantité attendues ; celui-ci donne `stock_supplier`, la
	 * quantité que le FABRICANT a derrière le grossiste, et rien sur la date à
	 * laquelle elle arriverait chez lui. Une date inventée à partir de ça serait
	 * une promesse de délai faite à un client sur une donnée qui n'existe pas.
	 *
	 * Le tableau vide est donc la réponse honnête, et `Purchase` la traite déjà
	 * comme « aucune information », pas comme « aucun réapprovisionnement ». La
	 * question est posée au fournisseur dans `QUESTIONS-ASSOCIE.md`.
	 *
	 * @return array<string,array{date:string,qty:int}>
	 */
	public static function deliveries( string $ref = '' ): array {
		unset( $ref );
		return array();
	}

	/**
	 * Transmet une commande au fournisseur.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * JAMAIS REPRISE, À AUCUN NIVEAU, ET LE SILENCE N'EST PAS UN NON.
	 *
	 * C'est le seul appel du projet où une seconde tentative produit une
	 * seconde livraison. `SupplyHttp::post_json` ne reprend pas non plus, et les
	 * deux le disent, parce que la règle doit survivre à la lecture de l'un des
	 * deux fichiers seulement.
	 *
	 * `$expect_mode` est ce que l'appelant CROIT être le mode du compte. Une
	 * divergence refuse : commander en vrai en croyant essayer coûte de
	 * l'argent, essayer en croyant commander en vrai coûte une livraison que
	 * personne n'attend.
	 *
	 * @param string                                              $key   Clé d'idempotence côté boutique.
	 * @param string                                              $expect_mode `test` ou `live`.
	 * @param array<array{sku:string,qty:int,lineRef:string}>      $lines
	 * @param array<string,mixed>                                 $ship  L'adresse de livraison.
	 * @return array{outcome:string,ok:bool,orderId:string,message:string,lines:array,mode:array}
	 */
	public static function place_order( string $key, string $expect_mode, array $lines, array $ship = array() ): array {
		$mode = self::mode();

		$refuse = static function ( string $message ) use ( $mode ): array {
			return array(
				'outcome' => 'rejected',
				'ok'      => false,
				'orderId' => '',
				'message' => $message,
				'lines'   => array(),
				'mode'    => $mode,
			);
		};

		if ( 'unknown' === $mode['mode'] ) {
			return $refuse( $mode['error'] );
		}
		if ( $expect_mode !== $mode['mode'] ) {
			return $refuse(
				'Le compte fournisseur est en mode « ' . $mode['mode'] .' » et la commande attendait « ' . $expect_mode . ' ». Rien n’a été transmis.'
			);
		}
		if ( array() === $lines ) {
			return $refuse( 'Aucune ligne à transmettre.' );
		}

		$order_lines = array();
		foreach ( $lines as $line ) {
			$sku = self::text( $line['sku'] ?? '' );
			$qty = (int) ( $line['qty'] ?? 0 );
			if ( '' === $sku || $qty < 1 ) {
				return $refuse( 'Une ligne de commande est incomplète : rien n’a été transmis.' );
			}
			$order_lines[] = array(
				'reference' => $sku,
				'quantity'  => $qty,
			);
		}

		$required = array( 'name', 'address', 'zip', 'city', 'country_code' );
		foreach ( $required as $field ) {
			if ( '' === self::text( $ship[ $field ] ?? '' ) ) {
				return $refuse( 'L’adresse de livraison est incomplète (« ' . $field . ' ») : rien n’a été transmis.' );
			}
		}

		$body = array(
			/*
			 * NOTRE CLÉ VOYAGE AVEC LA COMMANDE, tronquée à ce que le service
			 * accepte (20 caractères, dans son propre schéma). C'est ce qui
			 * permet de retrouver une commande dont la réponse s'est perdue, et
			 * donc de ne pas la repasser au jugé.
			 */
			'reference_internal' => substr( $key, 0, 20 ),
			'delivery_method'    => 2,
			'delivery_form'      => 2,
			'order_lines'        => $order_lines,
			'shipping_address'   => $ship,
		);

		$read = SupplyHttp::post_json( '/api/orders/create-order', $body );

		if ( ! $read['ok'] ) {
			/*
			 * UNE PANNE DE TRANSPORT N'EST PAS UN REFUS, et c'est la
			 * distinction qui décide si un humain doit aller regarder.
			 * `unknown` veut dire « la commande est peut-être partie » : on ne
			 * la repasse pas, et `Purchase` demande une vérification manuelle.
			 */
			$reason = (string) ( $read['reason'] ?? '' );
			return array(
				'outcome' => in_array( $reason, array( 'transport', 'upstream' ), true ) ? 'unknown' : 'rejected',
				'ok'      => false,
				'orderId' => '',
				'message' => (string) $read['error'],
				'lines'   => array(),
				'mode'    => $mode,
			);
		}

		$payload = (array) $read['body'];

		$code = (int) ( $read['code'] ?? 0 );
		if ( 422 === $code || 400 === $code ) {
			/*
			 * DEUX CODES, DEUX FORMES, ET AUCUNE COMMANDE CRÉÉE DANS LES DEUX.
			 * 422 rend un objet champ vers phrases (un champ obligatoire
			 * manque), 400 rend `{"errors":[...]}` (un numéro d'article est
			 * inconnu chez lui). `validation_message()` aplatit les deux, parce
			 * que ce que l'exploitant doit lire est la phrase, pas le code.
			 */
			return $refuse( 'Le fournisseur a refusé la commande : ' . self::validation_message( $payload ) );
		}

		/*
		 * ─────────────────────────────────────────────────────────────────────
		 * LE NUMÉRO EST DANS `order_infos`, ET LA DOCUMENTATION DIT AUTRE CHOSE.
		 *
		 * Le schéma publié montre `reference` à la RACINE de la réponse. Vérifié
		 * en passant une vraie commande d'essai le 9 septembre 2026
		 * (« IMB260900012 ») : la racine porte `success`, `status_code`,
		 * `message` et `order_infos`, et la référence est DANS `order_infos`.
		 * Lire la racine seule aurait rendu « accepté sans numéro » sur chaque
		 * commande réussie, c'est-à-dire l'état qui demande une vérification
		 * manuelle chez le fournisseur, sur toutes les commandes.
		 *
		 * Les deux endroits sont lus, celui qui existe d'abord : la
		 * documentation décrira peut-être un jour ce que le service fait.
		 */
		$infos    = is_array( $payload['order_infos'] ?? null ) ? $payload['order_infos'] : array();
		$order_id = self::text( $infos['reference'] ?? '' );
		if ( '' === $order_id ) {
			$order_id = self::text( $payload['reference'] ?? ( $payload['order_id'] ?? ( $payload['id'] ?? '' ) ) );
		}

		return array(
			'outcome' => '' !== $order_id ? 'accepted' : 'unknown',
			'ok'      => '' !== $order_id,
			'orderId' => $order_id,
			'message' => '' !== $order_id
				? 'Commande transmise.'
				: 'Le fournisseur a répondu sans numéro de commande. Vérifiez chez lui avant de repasser quoi que ce soit.',
			'lines'   => $order_lines,
			/*
			 * CE QUE LE FOURNISSEUR DIT NOUS FACTURER, ligne par ligne.
			 *
			 * La réponse renvoie le prix retenu pour chaque article. Sur la
			 * commande d'essai, 3,45 EUR sur BC01BSML, soit exactement ce que
			 * `price-stock` nous avait annoncé et ce sur quoi la marge a été
			 * calculée. C'est la seule confirmation que le prix sur lequel on a
			 * vendu est le prix qu'on paie, et personne ne la lisait : elle est
			 * remontée pour que `Purchase` puisse rapprocher, et un écart est
			 * une chose qu'un humain doit voir le jour même, pas au bilan.
			 */
			'confirmed' => self::confirmed_lines( $infos ),
			'mode'    => $mode,
		);
	}

	/**
	 * Les prix que le fournisseur confirme, numéro d'article vers centimes.
	 *
	 * La forme imbriquée est la sienne : `order_lines` est un objet dont les
	 * clés sont des identifiants internes, chacun portant un objet dont les clés
	 * sont les numéros d'article. On ne suppose donc aucune profondeur : on
	 * descend jusqu'à trouver un `price`, et on ignore le reste.
	 *
	 * @param array<string,mixed> $infos
	 * @return array<string,int>
	 */
	private static function confirmed_lines( array $infos ): array {
		$out   = array();
		$lines = is_array( $infos['order_lines'] ?? null ) ? $infos['order_lines'] : array();
		foreach ( $lines as $group ) {
			if ( ! is_array( $group ) ) {
				continue;
			}
			foreach ( $group as $sku => $line ) {
				if ( ! is_array( $line ) || ! isset( $line['price'] ) || ! is_numeric( $line['price'] ) ) {
					continue;
				}
				// `round` et non `(int)` : 4,55 EUR fois cent vaut 454,999... en
				// double sur certaines valeurs, et un centime perdu par ligne
				// sur un rapprochement de coûts est un rapprochement qui ne
				// tombe jamais juste.
				$out[ (string) $sku ] = (int) round( (float) $line['price'] * 100 );
			}
		}
		return $out;
	}

	/**
	 * Le message d'un 422, qui arrive en tableau champ vers liste de phrases.
	 *
	 * @param array<string,mixed> $payload
	 */
	private static function validation_message( array $payload ): string {
		$bits = array();
		foreach ( $payload as $field => $errors ) {
			foreach ( (array) $errors as $e ) {
				if ( is_string( $e ) && '' !== trim( $e ) ) {
					$bits[] = trim( $e );
				}
			}
			if ( count( $bits ) >= 6 ) {
				break;
			}
			unset( $field );
		}
		return array() === $bits ? 'motif non précisé.' : implode( ' ', $bits );
	}
}
