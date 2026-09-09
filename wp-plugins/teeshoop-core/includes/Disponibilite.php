<?php
/**
 * Est-ce que CET article est achetable maintenant, et combien nous coûte-t-il.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE PROBLÈME QUE CE FICHIER EXISTE POUR RÉSOUDRE
 *
 * Une seule route du fournisseur répond juste. Mesuré le 9 septembre 2026 sur
 * les mêmes codes, le même jour :
 *
 *   le flux de prix en masse ignore 31 847 codes sur 75 088 (42 %) et
 *   contredit la route en direct sur 21 % de ceux qu'il contient ;
 *   le flux de stock en masse datait de quatre mois en préproduction ;
 *   `GET /api/products/price-stock` répond pour TOUS les codes et à la seconde.
 *
 * Elle coûte 0,43 s de socle plus 0,068 s par code : 0,50 s pour un code,
 * 10,63 s pour un lot plein de 150, et 502 au 151e. C'est la contrainte
 * centrale de tout ce fichier. On ne peut pas l'appeler en rendant une page de
 * rayon, et on ne peut pas NE PAS l'appeler avant d'encaisser.
 *
 * D'où deux chemins, et pas un :
 *
 *   `known()` lit une table locale et ne parle à personne. C'est ce qu'une page
 *   affiche. Elle peut être en retard, et le dit (`at`).
 *
 *   `assert_buyable()` appelle le fournisseur, toujours, pour exactement les
 *   codes demandés, et ne lit jamais la table. C'est l'ajout au panier et le
 *   passage en caisse. Une réponse d'hier vendrait ici un article qui n'existe
 *   plus, et le client aurait payé.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TROIS ÉTATS, ET PAS DEUX
 *
 * La table distingue ce que la moitié des bogues de ce projet ont confondu :
 *
 *   pas de ligne          nous n'avons jamais demandé
 *   `miss = 1`            le fournisseur a répondu que ce code n'existe pas
 *   ligne intacte         nous avons demandé et nous n'avons pas pu savoir
 *
 * Le troisième n'écrit rien. Un lot qui échoue laisse ses lignes exactement où
 * elles étaient : « nous n'avons pas pu demander » n'est pas « il n'y en a
 * pas », et écraser une valeur connue par un vide est la façon dont on efface
 * le coût de 366 déclinaisons en une requête ratée.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `stock` ET `stock_supplier` NE SONT PAS LA MÊME CHOSE
 *
 * `stock` est ce que le grossiste a sur ses propres étagères. `stock_supplier`
 * est ce que le FABRICANT a derrière lui. On ne vend que contre le premier. Le
 * second est un signal de réassort et jamais une disponibilité : le service ne
 * publie aucune date d'arrivée, donc en déduire un délai serait une promesse
 * faite à un client sur une donnée qui n'existe pas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `cents` EST NOTRE PRIX D'ACHAT. IL NE SORT JAMAIS VERS UN NAVIGATEUR.
 *
 * `known()` et `assert_buyable()` le rendent parce que le moteur de prix en a
 * besoin côté serveur. Aucune de leurs sorties ne doit être renvoyée telle
 * quelle dans une réponse REST, dans un `wp_localize_script` ou dans un
 * gabarit : c'est exactement ce que `Shelf::SEALED` retire de chaque
 * représentation, et le retour de ce fichier contourne `Shelf`. Les phrases
 * françaises que ce fichier construit, elles, ne contiennent jamais de montant.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';
require_once __DIR__ . '/SupplyHttp.php';

final class Disponibilite {

	/**
	 * La seule route complète et actuelle. Voir l'en-tête pour les mesures.
	 *
	 * Ce n'est pas un nom de fournisseur et `scripts/php-guard.mjs` n'a donc
	 * rien à y redire : l'hôte, lui, en est un, et il vit dans une constante de
	 * `wp-config.php` que `SupplyHttp` est seul à lire.
	 */
	private const ROUTE = '/api/products/price-stock';

	/**
	 * Le socle et le coût par code, en millisecondes.
	 *
	 * Régression linéaire sur sept points mesurés le 9 septembre 2026 :
	 * 1 code 0,50 s, 150 codes 10,68 s. Le modèle prédit 10,63 s pour un lot
	 * plein, soit 0,5 % sous la mesure. AUCUNE MARGE N'EST AJOUTÉE ICI : une
	 * marge inventée serait un second nombre à côté d'un nombre mesuré, et ce
	 * n'est pas la prédiction qui protège `sweep()`, c'est l'horloge, relue
	 * après chaque lot. La prédiction sert seulement à ne pas COMMENCER un lot
	 * qu'on ne pourra pas finir.
	 *
	 * En millisecondes entières pour que l'arithmétique du budget ne passe pas
	 * par des flottants là où elle décide d'arrêter.
	 */
	private const CALL_FIXED_MS = 482;

	/**
	 * Le coût marginal d'un code. Voir CALL_FIXED_MS.
	 *
	 * REMESURÉ le 9 septembre 2026 sur le vrai service, six points de 1 à 150
	 * codes, régression linéaire : 482 ms de socle et 69,1 ms par code, contre
	 * 430 et 68 relevés plus tôt le même jour. La prédiction à 150 codes donne
	 * 10,9 s pour 10,8 s mesurées, donc le modèle décrit bien le service ; les
	 * deux constantes sont ramenées sur la mesure la plus récente plutôt que
	 * gardées parce qu'elles étaient déjà écrites.
	 */
	private const CALL_PER_CODE_MS = 69;

	/**
	 * Le plafond de temps que la vérification d'un panier a le droit de prendre.
	 *
	 * HYPOTHÈSE ASSUMÉE, et la seule de ce fichier.
	 *
	 * CE N'EST PAS `max_execution_time` QUI BORNE, contrairement à ce que ce
	 * commentaire affirmait : PHP ne compte pas l'attente sur une socket, donc
	 * un appel qui pend ne déclenche jamais ce garde-fou. Ce qui borne
	 * réellement, c'est le délai du serveur web devant PHP et la patience de
	 * l'acheteur, et vingt secondes sont un choix sur ces deux-là.
	 *
	 * ET LA BORNE EST TENUE PAR UNE HORLOGE, pas par ce nombre seul :
	 * `assert_buyable()` prend un instant limite au départ et n'engage aucun lot
	 * qu'il ne peut pas finir dedans, sans reprise. Sans cela, deux lots au
	 * délai maximal faisaient 42 s, et 82 avec les reprises.
	 *
	 * Le nombre d'articles autorisé n'est PAS écrit à la main : il est dérivé du
	 * modèle mesuré par `assert_cap()`, et il vaut 275 avec les constantes
	 * remesurées.
	 */
	private const ASSERT_MAX_SECONDS = 20.0;

	/**
	 * Les motifs qu'un appelant peut recevoir, et rien d'autre.
	 *
	 * Sept et pas trois, parce que chacun appelle une conduite différente et que
	 * les confondre est précisément ce qui a déjà coûté une couche à un client.
	 * « nous n'avons pas pu joindre » (`unreachable`), « il a répondu sans en
	 * parler » (`no_answer`) et « il a répondu que ça n'existe pas »
	 * (`unknown_article`) sont trois faits distincts, et un seul d'entre eux
	 * justifie de retirer l'article du catalogue.
	 */
	public const REASONS = array(
		'empty',
		'too_many',
		'unreachable',
		'no_answer',
		'unknown_article',
		'unpriced',
		'short_stock',
	);

	/**
	 * Le plafond des colonnes entières, et pourquoi il est ici.
	 *
	 * `INT` s'arrête à 2 147 483 647 et `INT UNSIGNED` à 4 294 967 295. MySQL
	 * tronque silencieusement au-delà selon le mode SQL, et un stock tronqué est
	 * un mensonge. Une valeur qui dépasse est donc refusée (nulle), jamais
	 * ramenée au plafond.
	 */
	private const MAX_COUNT = 2147483647;

	/** Idem pour les centimes, sur une colonne non signée. */
	private const MAX_CENTS = 4294967295;

	// -----------------------------------------------------------------------
	// La table
	// -----------------------------------------------------------------------

	/**
	 * Combien de temps une observation de stock reste utilisable quand le
	 * service ne répond pas, minutes.
	 *
	 * Six heures, alignées sur la période de `sweep()` : une fenêtre plus courte
	 * que le balayage refuserait des articles que la boutique vient justement de
	 * vérifier. C'est une HYPOTHÈSE de délai et non une mesure, et elle est
	 * posée à l'associé dans `QUESTIONS-ASSOCIE.md` : lui seul sait à partir de
	 * quand une quantité affichée cesse d'être une promesse tenable.
	 *
	 * ELLE VIT ICI ET NULLE PART AILLEURS. Le panier et la caisse la lisent tous
	 * les deux ; deux constantes pour une règle finissent par différer, et le
	 * jour où elles diffèrent le panier accepte ce que la caisse refuse, ce qui
	 * est la pire des deux incohérences puisque le client a déjà tout saisi.
	 */
	public const TRUST_MINUTES = 360;

	public static function table(): string {
		global $wpdb;
		return $wpdb->prefix . 'teeshoop_dispo';
	}

	/**
	 * Le corps de l'étape 5 de `Schema`, gardé à côté de la table qu'il crée.
	 *
	 * `Schema::step_dispo_table()` appelle ceci et vérifie le résultat. La table
	 * n'est donc PAS créée paresseusement au premier appel : c'est exactement le
	 * mécanisme que `Schema.php` raconte avoir remplacé, parce qu'il sait créer
	 * une table une fois et ne saura jamais lui ajouter une colonne ensuite.
	 *
	 * Contrat d'étape, respecté à la lettre : idempotent, ne recule jamais,
	 * O(1) donc `auto`, jette si le résultat n'est pas là, et rend une phrase
	 * française qu'un journal de déploiement peut imprimer.
	 *
	 * `get_charset_collate()` et pas un `utf8mb4` littéral : `unseen()` joint
	 * `code` à `postmeta.meta_value`, et deux interclassements différents font
	 * échouer la jointure sur un hébergeur dont le défaut n'est pas le nôtre.
	 * C'est le défaut que `Schema::step_sequence_table()` a déjà corrigé une
	 * fois.
	 */
	public static function install(): string {
		global $wpdb;
		$table   = self::table();
		$collate = $wpdb->get_charset_collate();
		$before  = self::table_exists( $table );

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.SchemaChange
		$wpdb->query(
			"CREATE TABLE IF NOT EXISTS {$table} (
				code VARCHAR(64) NOT NULL,
				cents INT UNSIGNED NULL,
				stock INT NULL,
				stock_supplier INT NULL,
				box_qty INT NULL,
				checked_at DATETIME NOT NULL,
				miss TINYINT(1) NOT NULL DEFAULT 0,
				PRIMARY KEY (code),
				KEY checked (checked_at)
			) {$collate}"
		);

		if ( ! self::table_exists( $table ) ) {
			throw new \RuntimeException( sprintf( 'la table %s n’existe toujours pas après le CREATE : %s', $table, (string) $wpdb->last_error ) );
		}

		return $before ? 'déjà présente' : 'créée';
	}

	private static function table_exists( string $table ): bool {
		global $wpdb;
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return (string) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) === $table;
	}

	// =======================================================================
	// PUR : rien ici n'appelle WordPress, ni le réseau, ni $wpdb.
	// C'est ce que tests/run.php exerce sans bootstrap, et c'est la moitié du
	// fichier où vivent toutes les décisions.
	// =======================================================================

	/**
	 * Un code d'article a-t-il une forme qu'on accepte d'envoyer et de stocker.
	 *
	 * Refuse plutôt que de nettoyer. Un code de plus de 64 caractères serait
	 * tronqué par la colonne et deviendrait la clé d'un AUTRE article ; un code
	 * qui contient une virgule couperait la liste CSV en deux et ferait
	 * demander un article que personne n'a mis au panier.
	 */
	public static function valid_code( string $code ): bool {
		if ( '' === $code || strlen( $code ) > 64 ) {
			return false;
		}
		return 1 === preg_match( '/^[A-Za-z0-9._\/-]+$/', $code );
	}

	/**
	 * Rogne, refuse et dédoublonne une liste de codes.
	 *
	 * Le dédoublonnage est insensible à la casse parce que la clé primaire de la
	 * table l'est (interclassement `_ci`) : « bc01bsml » et « BC01BSML » sont
	 * une seule ligne, et les envoyer tous les deux paierait 0,068 s pour rien
	 * puis ferait s'écraser deux écritures l'une l'autre. La graphie conservée
	 * est la première vue, celle de l'appelant.
	 *
	 * @param array<mixed> $codes
	 * @return string[]
	 */
	public static function clean_codes( array $codes ): array {
		$out  = array();
		$seen = array();
		foreach ( $codes as $code ) {
			if ( ! is_string( $code ) && ! is_int( $code ) ) {
				continue;
			}
			$code = trim( (string) $code );
			if ( ! self::valid_code( $code ) ) {
				continue;
			}
			$up = strtoupper( $code );
			if ( isset( $seen[ $up ] ) ) {
				continue;
			}
			$seen[ $up ] = true;
			$out[]       = $code;
		}
		return $out;
	}

	/**
	 * Découpe en lots que la route accepte.
	 *
	 * LE PLAFOND EST IMPOSÉ AVANT L'APPEL, JAMAIS DÉCOUVERT PAR UN 502. Le
	 * `min()` sur `$max` n'est pas de la prudence décorative : il est là pour
	 * que le jour où un appelant passe 151, ce fichier fasse deux lots au lieu
	 * d'un appel mort. 151 codes ne dégradent pas la réponse du service, ils la
	 * suppriment.
	 *
	 * @param string[] $codes
	 * @param int|null $max   Défaut : le plafond mesuré du service.
	 * @return array<int,string[]>
	 */
	public static function batches( array $codes, ?int $max = null ): array {
		$cap = null === $max ? SupplyHttp::LIVE_BATCH_MAX : $max;
		$cap = max( 1, min( SupplyHttp::LIVE_BATCH_MAX, $cap ) );
		if ( array() === $codes ) {
			return array();
		}
		return array_chunk( array_values( $codes ), $cap );
	}

	/**
	 * Un prix du service vers des centimes entiers, ou null.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * POURQUOI `round()` ET JAMAIS `(int) ( $x * 100 )`
	 *
	 * Mesuré sur cette machine (PHP 8.5) : sur les 2 000 premiers montants à
	 * deux décimales, 137 (6,85 %) perdent un centime avec la troncature.
	 * 0,29 devient 28, 1,15 devient 114, 2,01 devient 200. Un centime par
	 * article, dans le sens qui nous appauvrit, sur un achat sur quinze.
	 *
	 * CORRECTION À L'EXEMPLE QU'ON M'A DONNÉ : 4,55 n'en fait PAS partie ici.
	 * `4.55 * 100` tombe exactement sur 455,0 en double précision, donc la
	 * troncature rend 455 comme l'arrondi. Le test garde 4,55 (c'est la valeur
	 * citée dans la consigne, et il vaut mieux qu'elle soit couverte) mais il
	 * porte AUSSI les trois montants sur lesquels la différence existe
	 * vraiment, sinon il prouverait un comportement que les deux écritures
	 * partagent.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * ZÉRO N'EST PAS UN PRIX
	 *
	 * « 0 », « », un texte, un négatif : on rend null. Un article gratuit
	 * n'existe pas chez ce fournisseur, et écrire 0 ferait vendre un textile à
	 * son coût déclaré nul, donc sous son plancher, sans que rien n'ait l'air
	 * anormal.
	 *
	 * On ne lit PAS la virgule française ici, contrairement à `Money::from_eur`,
	 * qui existe pour ce qu'un administrateur tape. Le service envoie un point.
	 * Une virgule voudrait dire que la réponse n'est pas celle qu'on croit, et
	 * la deviner serait deviner un prix.
	 *
	 * @param mixed $raw
	 */
	public static function parse_price_cents( $raw ): ?int {
		if ( is_int( $raw ) ) {
			$value = (float) $raw;
		} elseif ( is_float( $raw ) ) {
			$value = $raw;
		} elseif ( is_string( $raw ) ) {
			$text = trim( $raw );
			if ( '' === $text || ! is_numeric( $text ) ) {
				return null;
			}
			$value = (float) $text;
		} else {
			return null;
		}

		if ( ! is_finite( $value ) || $value <= 0.0 ) {
			return null;
		}
		/*
		 * DEUX BORNES, ET DANS CET ORDRE. La première protège le passage en
		 * entier : au-delà de PHP_INT_MAX un `(int) round()` ne rend pas un
		 * grand nombre, il rend n'importe quoi. La seconde porte sur les
		 * CENTIMES ARRONDIS et pas sur le produit flottant : `42949672.95 * 100`
		 * vaut un cheveu de plus que 4 294 967 295 en double précision, donc
		 * comparer le produit refusait le plus grand montant que la colonne sait
		 * pourtant contenir. Mesuré en écrivant le test de cette borne.
		 */
		if ( $value > (float) PHP_INT_MAX / 100 ) {
			return null;
		}
		$cents = Money::round( $value * 100 );

		return ( $cents <= 0 || $cents > self::MAX_CENTS ) ? null : $cents;
	}

	/**
	 * Une quantité du service vers un entier, ou null.
	 *
	 * NULL ET ZÉRO SONT DEUX RÉPONSES. Zéro veut dire « il n'en reste pas »,
	 * null veut dire « on n'a pas su lire », et `verdict()` refuse la vente dans
	 * les deux cas mais ne dit pas la même phrase.
	 *
	 * Un négatif est ramené à zéro : certains systèmes de gestion publient un
	 * stock négatif quand ils ont survendu, et pour une disponibilité cela veut
	 * dire zéro. Un fractionnaire est arrondi vers le bas, parce que la moitié
	 * d'un tee-shirt ne se vend pas et que le sens conservateur est le bas.
	 *
	 * @param mixed $raw
	 */
	public static function parse_count( $raw ): ?int {
		if ( is_int( $raw ) ) {
			$value = (float) $raw;
		} elseif ( is_float( $raw ) ) {
			$value = $raw;
		} elseif ( is_string( $raw ) ) {
			$text = trim( $raw );
			if ( '' === $text || ! is_numeric( $text ) ) {
				return null;
			}
			$value = (float) $text;
		} else {
			return null;
		}

		if ( ! is_finite( $value ) ) {
			return null;
		}
		if ( $value > (float) self::MAX_COUNT ) {
			return null;
		}

		return max( 0, (int) floor( $value ) );
	}

	/**
	 * Quels codes DEMANDÉS le service déclare introuvables.
	 *
	 * Le service répond 200 avec « Les references produit suivantes sont
	 * introuvables : X, Y ». C'est du texte, pas une liste, donc on le découpe
	 * et on ne retient QUE des jetons entiers qui figurent dans ce qu'on a
	 * demandé. Deux propriétés en découlent, et les deux comptent :
	 *
	 *   un code jamais demandé ne peut pas être marqué introuvable, quoi que la
	 *   phrase raconte ;
	 *
	 *   « BC01B » dans la phrase ne marque PAS « BC01BSML », parce que la
	 *   comparaison porte sur des jetons et pas sur une sous-chaîne. La
	 *   référence du grossiste est le préfixe de chacun de ses articles, donc
	 *   un `str_contains` retirerait du catalogue les 228 déclinaisons d'une
	 *   référence dont une seule manque.
	 *
	 * La comparaison ignore la casse, et rend la graphie de l'appelant : le
	 * service majuscule ses codes dans cette phrase alors qu'il les rend tels
	 * quels ailleurs.
	 *
	 * @param mixed                 $raw   La valeur de `products_not_found`.
	 * @param array<string,string>  $index MAJUSCULE => graphie demandée.
	 * @return string[]
	 */
	public static function missing_from_message( $raw, array $index ): array {
		$tokens = array();

		if ( is_array( $raw ) ) {
			foreach ( $raw as $value ) {
				if ( is_string( $value ) || is_int( $value ) ) {
					$tokens[] = (string) $value;
				}
			}
		} elseif ( is_string( $raw ) ) {
			$tail  = $raw;
			$colon = strrpos( $raw, ':' );
			if ( false !== $colon ) {
				$tail = substr( $raw, $colon + 1 );
			}
			$split  = preg_split( '/[\s,;]+/u', $tail );
			$tokens = is_array( $split ) ? $split : array();
		}

		$out = array();
		foreach ( $tokens as $token ) {
			$token = trim( (string) $token, " \t\n\r\0\x0B.,;:«»\"'" );
			if ( '' === $token ) {
				continue;
			}
			$up = strtoupper( $token );
			if ( isset( $index[ $up ] ) && ! in_array( $index[ $up ], $out, true ) ) {
				$out[] = $index[ $up ];
			}
		}

		return $out;
	}

	/**
	 * Une réponse du service vers des lignes, des absences et des silences.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * TROIS SORTIES, PARCE QU'IL Y A TROIS FAITS
	 *
	 *   `rows`        le service a répondu pour ce code
	 *   `missing`     le service a dit que ce code n'existe pas
	 *   `unanswered`  on l'a demandé et la réponse n'en parle pas
	 *
	 * Le troisième n'autorise AUCUNE écriture. C'est le seul moyen qu'un lot
	 * partiel ne fasse pas disparaître un article dont il se trouve que le
	 * service n'a rien dit.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * UNE PAGE HTML N'EST PAS UN CATALOGUE VIDE
	 *
	 * Un jeton faux ne rend pas 401 sur ce service, il rend 302 vers une page de
	 * connexion. `SupplyHttp::read()` arrête ça sur le type de contenu, et cette
	 * méthode ferme la même porte une seconde fois, en bas : un corps sans clé
	 * `products` est un refus motivé, et un corps qui ne mentionne AUCUN des
	 * codes demandés aussi. « zéro produit » et « je n'ai pas compris la
	 * réponse » ne doivent pas mener au même écran, ni à la même écriture.
	 *
	 * @param array<mixed> $body  Le corps décodé.
	 * @param string[]     $asked Les codes envoyés. Vide pour un appel par référence.
	 * @return array{ok:bool,rows:array<string,array{cents:?int,stock:?int,stock_supplier:?int,box_qty:?int}>,missing:string[],unanswered:string[],error:string}
	 */
	public static function parse_rows( array $body, array $asked ): array {
		$index = array();
		foreach ( $asked as $code ) {
			$code = trim( (string) $code );
			if ( '' !== $code ) {
				$index[ strtoupper( $code ) ] = $code;
			}
		}

		$out = array(
			'ok'         => false,
			'rows'       => array(),
			'missing'    => array(),
			'unanswered' => array_values( $index ),
			'error'      => '',
		);

		if ( ! array_key_exists( 'products', $body ) || ! is_array( $body['products'] ) ) {
			$out['error'] = 'Le service prix/stock a répondu sans liste d’articles. Ce n’est pas un catalogue vide, c’est une réponse qu’on ne sait pas lire.';
			return $out;
		}

		foreach ( $body['products'] as $key => $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}

			/*
			 * LE CODE VIENT DE LA LIGNE D'ABORD, DE LA CLÉ ENSUITE. La forme
			 * `?products=CSV` rend un objet indexé par code ; la forme
			 * `/price-stock/{reference}` rend une liste où le code est un champ.
			 * Un seul lecteur pour les deux, sinon il y en aura deux à corriger.
			 *
			 * ─────────────────────────────────────────────────────────────────
			 * LA CLÉ PEUT ÊTRE UN ENTIER, ET LA REFUSER PERDAIT TOUT LE LOT.
			 *
			 * `json_decode( …, true )` transforme une clé d'objet entièrement
			 * numérique en clé de tableau ENTIÈRE : « "180010007": {…} » revient
			 * avec la clé int(180010007). Le test `is_string( $key )` la
			 * refusait donc, la ligne était sautée, et un lot dont TOUS les
			 * codes sont numériques rendait zéro ligne, ce que la méthode lit
			 * plus bas comme « le service n'a mentionné aucun des articles
			 * demandés », donc comme un lot injoignable.
			 *
			 * La conséquence est exactement celle que ce fichier existe pour
			 * empêcher : le panier retombait alors sur le repli de six heures et
			 * vendait contre une observation d'hier, sans qu'aucune erreur
			 * n'apparaisse nulle part. Trouvé le 9 septembre 2026 en faisant
			 * passer la suite d'intégration par cette route.
			 *
			 * Les références du fournisseur d'aujourd'hui sont alphanumériques,
			 * donc rien ne le déclenchait ; c'est ce qui rend le défaut cher, pas
			 * ce qui le rend inoffensif.
			 */
			$code = isset( $row['code'] ) && ( is_string( $row['code'] ) || is_int( $row['code'] ) ) ? trim( (string) $row['code'] ) : '';
			if ( '' === $code && ( is_string( $key ) || is_int( $key ) ) ) {
				$code = trim( (string) $key );
			}
			if ( ! self::valid_code( $code ) ) {
				continue;
			}

			// Répondre sous la graphie de l'appelant, pour qu'il retrouve ses clés.
			$code = $index[ strtoupper( $code ) ] ?? $code;

			$out['rows'][ $code ] = array(
				'cents'          => self::parse_price_cents( $row['price'] ?? null ),
				'stock'          => self::parse_count( $row['stock'] ?? null ),
				'stock_supplier' => self::parse_count( $row['stock_supplier'] ?? null ),
				'box_qty'        => self::parse_count( $row['quantity_box'] ?? null ),
			);
		}

		$out['missing'] = self::missing_from_message( $body['products_not_found'] ?? null, $index );

		$seen = array();
		foreach ( array_keys( $out['rows'] ) as $code ) {
			$seen[ strtoupper( (string) $code ) ] = true;
		}
		foreach ( $out['missing'] as $code ) {
			$seen[ strtoupper( $code ) ] = true;
		}
		$out['unanswered'] = array();
		foreach ( $index as $up => $code ) {
			if ( ! isset( $seen[ $up ] ) ) {
				$out['unanswered'][] = $code;
			}
		}

		/*
		 * UNE RÉPONSE QUI NE PARLE D'AUCUN DES CODES DEMANDÉS N'EST PAS UNE
		 * RÉPONSE. Elle ne marque rien, elle n'écrit rien, et elle le dit. Sans
		 * ce garde-fou, un corps JSON valide mais étranger passerait pour
		 * « aucun de vos articles n'a de stock », ce qui est la même faute que
		 * la page de connexion lue comme un catalogue.
		 */
		if ( array() !== $index && array() === $out['rows'] && array() === $out['missing'] ) {
			$out['error'] = sprintf(
				'Le service prix/stock a répondu sans mentionner aucun des %d articles demandés.',
				count( $index )
			);
			return $out;
		}

		$out['ok'] = true;
		return $out;
	}

	// -----------------------------------------------------------------------
	// Le verdict, pur, et les phrases qu'un client lit
	// -----------------------------------------------------------------------

	/**
	 * Est-ce que ce panier est achetable, article par article.
	 *
	 * PUR ET SÉPARÉ DE L'APPEL RÉSEAU, parce que c'est le moment de vérité et
	 * qu'un moment de vérité qu'on ne peut tester qu'avec un fournisseur au bout
	 * du fil n'est pas testé.
	 *
	 * L'ORDRE DES TESTS EST LA DÉCISION. On refuse d'abord ce qu'on ne sait pas
	 * (lot injoignable, article inconnu, pas de ligne), ensuite ce qu'on ne peut
	 * pas facturer (pas de prix), ensuite ce qu'on n'a pas (stock illisible,
	 * stock court). Un article sans prix ET en rupture est annoncé sans prix :
	 * c'est notre problème avant d'être celui du client, et lui demander de
	 * réduire la quantité d'un article qu'on ne saurait pas vendre serait le
	 * faire travailler pour rien.
	 *
	 * Un code qu'on n'a jamais pu envoyer (forme refusée par `valid_code`) n'est
	 * dans aucune des trois listes et tombe donc en `no_answer`, ce qui est
	 * exact : on n'a rien appris à son sujet.
	 *
	 * @param array<string,int>                                                            $wanted      code => quantité.
	 * @param array<string,array{cents:?int,stock:?int,stock_supplier:?int,box_qty:?int}>  $rows        Ce que le service a répondu.
	 * @param string[]                                                                     $missing     Ce qu'il déclare introuvable.
	 * @param string[]                                                                     $unreachable Les codes dont le lot a échoué.
	 * @return array{ok:bool,reason:string,lines:array<string,array{ok:bool,why:string,cents:?int,stock:?int,qty:int,message:string}>,message:string}
	 */
	public static function verdict( array $wanted, array $rows, array $missing, array $unreachable, array $labels = array() ): array {
		$by_code = array();
		foreach ( $rows as $code => $row ) {
			$by_code[ strtoupper( (string) $code ) ] = $row;
		}
		$absent = array();
		foreach ( $missing as $code ) {
			$absent[ strtoupper( (string) $code ) ] = true;
		}
		$mute = array();
		foreach ( $unreachable as $code ) {
			$mute[ strtoupper( (string) $code ) ] = true;
		}

		/*
		 * ─────────────────────────────────────────────────────────────────────
		 * LA DEMANDE EST TOTALISÉE PAR ARTICLE AVANT D'ÊTRE COMPARÉE AU STOCK.
		 *
		 * Trouvé par une relecture adverse, et c'était une survente. Les
		 * recherches de ce fichier ignorent la casse, parce que la clé primaire
		 * de la table l'ignore. Donc un panier qui porte « BC01BSML » sur une
		 * ligne et « bc01bsml » sur une autre présentait DEUX demandes de 5 à un
		 * stock de 7, et les deux passaient : le client repartait avec 10
		 * exemplaires d'un article dont il en restait 7. Cette boutique vend du
		 * personnalisé, donc deux lignes du même article avec deux visuels
		 * différents est le cas NORMAL et pas le cas tordu.
		 *
		 * On totalise donc d'abord, on décide sur le total, et chaque ligne
		 * d'entrée reçoit le verdict de l'article entier.
		 */
		$demand = array();
		foreach ( $wanted as $code => $qty ) {
			$up = strtoupper( trim( (string) $code ) );
			/*
			 * Une quantité absurde est ramenée à 1 plutôt que de faire refuser
			 * tout le panier : une ligne à zéro n'est pas un achat, et la
			 * question qui reste utile est « cet article existe-t-il ».
			 */
			$demand[ $up ] = ( $demand[ $up ] ?? 0 ) + max( 1, (int) $qty );
		}

		$lines = array();
		foreach ( array_keys( $wanted ) as $key ) {
			$code = trim( (string) $key );
			$up   = strtoupper( $code );
			/*
			 * UNE CLÉ ILLISIBLE GARDE SA LIGNE, ELLE NE DISPARAÎT PAS. Elle
			 * était passée par `continue`, et une ligne de panier qui
			 * s'évapore d'une vérification est une ligne vendue sans avoir été
			 * vérifiée. Elle n'est dans aucune des trois listes, donc elle tombe
			 * en `no_answer`, ce qui est exact et ce qui refuse.
			 */
			$qty = $demand[ $up ] ?? 1;
			$row = $by_code[ $up ] ?? null;

			if ( '' === $code ) {
				$why = 'no_answer';
			} elseif ( isset( $mute[ $up ] ) ) {
				$why = 'unreachable';
			} elseif ( isset( $absent[ $up ] ) ) {
				$why = 'unknown_article';
			} elseif ( ! is_array( $row ) ) {
				$why = 'no_answer';
			} elseif ( null === $row['cents'] ) {
				$why = 'unpriced';
			} elseif ( null === $row['stock'] ) {
				$why = 'no_answer';
			} elseif ( $row['stock'] < $qty ) {
				$why = 'short_stock';
			} else {
				$why = 'ok';
			}

			$lines[ (string) $key ] = array(
				'ok'      => 'ok' === $why,
				'why'     => $why,
				'cents'   => is_array( $row ) ? $row['cents'] : null,
				'stock'   => is_array( $row ) ? $row['stock'] : null,
				'qty'     => $qty,
				'message' => self::line_message( $code, $why, $qty, is_array( $row ) ? $row : array(), (string) ( $labels[ $code ] ?? '' ) ),
			);
		}

		/*
		 * ZÉRO LIGNE N'EST PAS « TOUT VA BIEN ». Sans ce refus, un panier dont
		 * aucune clé n'a pu être lue repartait avec « Tous les articles
		 * demandés sont disponibles », c'est-à-dire le feu vert de la caisse
		 * sur un panier que personne n'a vérifié. C'est la même règle que
		 * `scripts/bundle-guard.mjs` applique à lui-même : « rien trouvé » et
		 * « rien regardé » sont deux résultats.
		 */
		if ( array() === $lines ) {
			return array(
				'ok'      => false,
				'reason'  => 'empty',
				'lines'   => array(),
				'message' => 'Aucun article à vérifier.',
			);
		}

		$failing = array_filter( $lines, static fn( array $l ): bool => ! $l['ok'] );
		if ( array() === $failing ) {
			return array(
				'ok'      => true,
				'reason'  => '',
				'lines'   => $lines,
				'message' => 'Tous les articles demandés sont disponibles.',
			);
		}

		/*
		 * UN SEUL MOTIF EN TÊTE, ET IL EST DÉTERMINISTE. Il ne dépend pas de
		 * l'ordre du panier mais d'une précédence écrite : d'abord ce sur quoi
		 * le client ne peut rien (on n'a pas pu savoir), en dernier ce qu'il
		 * peut corriger lui-même (réduire une quantité). Toutes les lignes
		 * fautives doivent de toute façon être réglées, donc annoncer la moins
		 * réparable est ce qui décrit honnêtement le refus.
		 */
		$reason = '';
		foreach ( array( 'unreachable', 'no_answer', 'unknown_article', 'unpriced', 'short_stock' ) as $candidate ) {
			foreach ( $failing as $line ) {
				if ( $candidate === $line['why'] ) {
					$reason = $candidate;
					break 2;
				}
			}
		}

		return array(
			'ok'      => false,
			'reason'  => $reason,
			'lines'   => $lines,
			'message' => self::basket_message( $failing ),
		);
	}

	/**
	 * Ce qu'un client lit à propos d'UN article.
	 *
	 * Chaque motif a sa phrase, et chaque phrase dit ce qui s'est passé puis ce
	 * qu'il peut faire. Pas d'excuse, pas de « oups », pas de point
	 * d'exclamation, et jamais un montant : ce fichier connaît notre prix
	 * d'achat et il n'a rien à en dire à qui que ce soit.
	 *
	 * @param array{cents?:?int,stock?:?int,stock_supplier?:?int,box_qty?:?int} $row
	 */
	/**
	 * La première lettre en majuscule, pour une étiquette qui ouvre une phrase.
	 *
	 * `ucfirst` ne suffit pas : il travaille par octet et une étiquette peut
	 * commencer par un caractère accentué (« Écru en taille M »). `mb_substr`
	 * est disponible partout où ce greffon tourne, et le repli sur la chaîne
	 * intacte vaut mieux qu'une lettre coupée en deux.
	 */
	private static function capitalise( string $s ): string {
		if ( '' === $s || ! function_exists( 'mb_substr' ) ) {
			return $s;
		}
		return mb_strtoupper( mb_substr( $s, 0, 1 ) ) . mb_substr( $s, 1 );
	}

	public static function line_message( string $code, string $why, int $qty, array $row, string $label = '' ): string {
		/*
		 * ─────────────────────────────────────────────────────────────────────
		 * LE NUMÉRO D'ARTICLE NE SORT JAMAIS, ET C'EST UNE CORRECTION MESURÉE.
		 *
		 * Ces phrases s'affichent au panier et en caisse. Elles nommaient
		 * `$code`, qui est `Catalogue::META_SUPPLY_SKU`, exactement la valeur que
		 * `Shelf::SEALED` retire de REST, de l'export CSV, du JSON de
		 * déclinaison et de l'affichage d'une ligne de commande, parce que c'est
		 * une empreinte de chez qui nous achetons. Reproduit de bout en bout par
		 * la vraie route le 9 septembre 2026 : un visiteur anonyme demandant
		 * cinquante pièces d'une taille qui en a trois recevait « Il reste 3
		 * exemplaires de l'article 015421122 », d'où se déduisent la référence du
		 * grossiste et donc son catalogue public.
		 *
		 * `scripts/php-guard.mjs` ne pouvait pas le voir : la chaîne est
		 * composée à l'exécution, aucun littéral interdit n'est écrit ici.
		 *
		 * `$label` est ce qu'un client a choisi (« le noir en taille M »), fourni
		 * par `Purchase::codes_for_matrix` qui tient la déclinaison. Vide, on dit
		 * « cet article », qui est vague et vrai, plutôt que précis et interdit.
		 * `$code` reste dans la signature parce que le SERVEUR en a besoin pour
		 * journaliser, et il n'est plus jamais imprimé.
		 */
		$quoi = '' !== trim( $label ) ? trim( $label ) : 'cet article';
		unset( $code );
		/*
		 * `$known` EST SÉPARÉ DE `$left`, ET C'EST UNE CORRECTION. Le stock
		 * absent tombait sur `$left = 0` et faisait annoncer « n'est plus en
		 * stock », c'est-à-dire une rupture affirmée à un client à partir d'un
		 * chiffre qu'on n'a pas su lire. `verdict()` n'emprunte pas ce chemin,
		 * mais cette méthode est publique et le prochain appelant, lui, ne le
		 * saura pas. Une rupture est un fait, elle ne s'annonce que mesurée.
		 */
		$known = array_key_exists( 'stock', $row ) && null !== $row['stock'];
		$left  = $known ? (int) $row['stock'] : 0;
		$maker = isset( $row['stock_supplier'] ) && null !== $row['stock_supplier'] ? (int) $row['stock_supplier'] : 0;

		if ( 'short_stock' === $why && ! $known ) {
			$why = 'no_answer';
		}

		switch ( $why ) {
			case 'ok':
				return sprintf( '%s est disponible.', self::capitalise( $quoi ) );

			case 'unreachable':
				return sprintf(
					'Nous n’avons pas pu vérifier la disponibilité de %s auprès de notre fournisseur. Réessayez dans quelques minutes.',
					$quoi
				);

			case 'no_answer':
				return sprintf(
					'Notre fournisseur n’a rien répondu au sujet de %s. Réessayez dans quelques minutes, ou choisissez une autre taille.',
					$quoi
				);

			case 'unknown_article':
				return sprintf(
					'%s n’est plus disponible. Choisissez une autre taille ou un autre coloris.',
					self::capitalise( $quoi )
				);

			case 'unpriced':
				return sprintf(
					'Nous ne pouvons pas vendre %s pour le moment. Choisissez une autre taille ou un autre coloris, ou écrivez-nous.',
					$quoi
				);

			case 'short_stock':
				if ( $left <= 0 ) {
					$phrase = sprintf( '%s n’est plus en stock. Choisissez une autre taille ou un autre coloris.', self::capitalise( $quoi ) );
				} else {
					$phrase = sprintf(
						'Il reste %s %s de %s, et vous en demandez %s. Ramenez la quantité à %s, ou choisissez une autre taille.',
						Money::number( (float) $left ),
						1 === $left ? 'exemplaire' : 'exemplaires',
						$quoi,
						Money::number( (float) $qty ),
						Money::number( (float) $left )
					);
				}
				/*
				 * LE STOCK DU FABRICANT EST UN SIGNAL, PAS UNE DISPONIBILITÉ.
				 * On le mentionne parce qu'un client qui attend un réassort
				 * préfère le savoir, et on ne promet aucune date parce que le
				 * service n'en publie aucune.
				 */
				if ( $maker > 0 ) {
					$phrase .= ' Le fabricant en a encore, un réassort est donc possible : écrivez-nous pour connaître le délai.';
				}
				return $phrase;
		}

		return sprintf( '%s ne peut pas être commandé. Écrivez-nous et nous regarderons.', self::capitalise( $quoi ) );
	}

	/**
	 * La phrase du panier entier.
	 *
	 * Une ligne fautive : sa phrase, telle quelle, parce qu'elle est déjà
	 * complète. Plusieurs : on annonce le nombre puis on détaille, borné à
	 * trois, sinon un panier de gros abonne le client à un mur de texte.
	 *
	 * @param array<string,array{message:string}> $failing
	 */
	public static function basket_message( array $failing ): string {
		$messages = array_values( array_map( static fn( array $l ): string => (string) $l['message'], $failing ) );
		$count    = count( $messages );

		if ( 0 === $count ) {
			return 'Tous les articles demandés sont disponibles.';
		}
		if ( 1 === $count ) {
			return $messages[0];
		}

		$shown = array_slice( $messages, 0, 3 );
		$out   = sprintf( '%d articles du panier ne peuvent pas être commandés. ', $count ) . implode( ' ', $shown );
		if ( $count > 3 ) {
			$rest = $count - 3;
			$out .= sprintf( ' Et %d autre%s dans le même cas.', $rest, 1 === $rest ? '' : 's' );
		}
		return $out;
	}

	// -----------------------------------------------------------------------
	// Le budget, pur, et dérivé de la mesure
	// -----------------------------------------------------------------------

	/** Ce qu'un appel de `$n` codes coûte, secondes. Voir CALL_FIXED_MS. */
	public static function call_seconds( int $n ): float {
		$n = max( 0, $n );
		return ( self::CALL_FIXED_MS + self::CALL_PER_CODE_MS * $n ) / 1000;
	}

	/**
	 * Ce que `$n` codes coûtent en tout, lots compris.
	 *
	 * Le socle est payé UNE FOIS PAR LOT et pas une fois par marche : 151 codes
	 * coûtent deux socles. Un budget qui l'oublierait s'arrêterait toujours un
	 * demi-lot trop tard.
	 */
	public static function plan_seconds( int $n ): float {
		$n = max( 0, $n );
		if ( 0 === $n ) {
			return 0.0;
		}
		$batches = (int) ceil( $n / SupplyHttp::LIVE_BATCH_MAX );
		return ( $batches * self::CALL_FIXED_MS + self::CALL_PER_CODE_MS * $n ) / 1000;
	}

	/**
	 * Combien de codes tiennent dans le temps qui reste, pour UN lot.
	 *
	 * Zéro veut dire « pas même un » et c'est là que le balayeur s'arrête. Il ne
	 * commence jamais un lot qu'il ne peut pas finir : le couper au milieu
	 * laisserait la moitié des lignes rafraîchies et l'autre moitié avec un
	 * horodatage qui prétend le contraire.
	 */
	public static function codes_that_fit( float $seconds ): int {
		$room = $seconds - self::CALL_FIXED_MS / 1000;
		if ( $room <= 0 ) {
			return 0;
		}
		return (int) min( SupplyHttp::LIVE_BATCH_MAX, (int) floor( $room / ( self::CALL_PER_CODE_MS / 1000 ) ) );
	}

	/**
	 * Le plus grand panier vérifiable en `$seconds`, lots compris.
	 *
	 * Une boucle et pas une formule fermée, DÉLIBÉRÉMENT : le `ceil()` du
	 * nombre de lots fait de l'algèbre une analyse de cas que personne ne
	 * relirait, alors que `plan_seconds()` est monotone en `$n` et que la
	 * boucle est donc la définition même de la réponse. Elle tourne 281 fois
	 * pour vingt secondes, ce qui ne coûte rien.
	 */
	public static function assert_cap( float $seconds ): int {
		$n = 0;
		while ( $n < 100000 && self::plan_seconds( $n + 1 ) <= $seconds ) {
			++$n;
		}
		return $n;
	}

	/**
	 * Comment un passage du balayeur partage sa place entre les deux files.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * POURQUOI CE N'EST PAS « LES JAMAIS VUS D'ABORD »
	 *
	 * C'est ce que ce fichier faisait, et une relecture adverse a chiffré ce que
	 * cela donne : 26 392 déclinaisons importées n'ont aucune ligne, un passage
	 * en traite 281, donc il faut 94 passages avant que cette file se vide. Avec
	 * une tâche horaire, cela fait QUATRE JOURS pendant lesquels aucune ligne
	 * existante n'est rafraîchie, et les prix affichés vieillissent sans que
	 * rien n'avance de ce côté-là.
	 *
	 * La moitié va donc à chaque file. Celle qui n'a pas de quoi remplir sa part
	 * la rend à l'autre, dans `sweep()`, pour qu'une moitié vide ne coûte pas la
	 * moitié du passage. Les deux avancent tous les jours, et le seul prix est
	 * que l'amorçage prend deux fois plus longtemps.
	 *
	 * @return array{unseen:int,stale:int}
	 */
	public static function queue_split( int $want ): array {
		$want = max( 0, $want );
		if ( 0 === $want ) {
			return array(
				'unseen' => 0,
				'stale'  => 0,
			);
		}
		$half = max( 1, intdiv( $want, 2 ) );
		return array(
			'unseen' => $half,
			'stale'  => $want - $half,
		);
	}

	/**
	 * Le délai à donner à un appel de `$n` codes, secondes.
	 *
	 * Dérivé du modèle mesuré, plus dix secondes pour la poignée de main TLS et
	 * pour un mutualisé qui a un mauvais jour. Un lot plein est donc borné à
	 * 21 s, là où il en prend 10,7 : deux fois la mesure, sans recopier ailleurs
	 * un nombre que `SupplyHttp` garde déjà pour lui.
	 */
	public static function timeout_for( int $n ): int {
		return max( 10, (int) ceil( self::call_seconds( $n ) ) + 10 );
	}

	// =======================================================================
	// FIN DU PUR. Ce qui suit parle au réseau et à la base, et rien d'autre.
	// =======================================================================

	/**
	 * Un lot : demander, lire, écrire. LE SEUL ENDROIT QUI FAIT CES TROIS-LÀ.
	 *
	 * `refresh()` et `assert_buyable()` passent tous les deux par ici. S'ils
	 * avaient chacun leur appel, ils auraient chacun leur idée de ce qu'est une
	 * réponse acceptable, et le jour où elles divergent c'est la caisse qui a
	 * tort. `assert_buyable()` ne LIT jamais la table, mais il y écrit : il
	 * vient de payer 10 s pour cette réponse, la jeter serait la repayer.
	 *
	 * @param string[] $batch Au plus LIVE_BATCH_MAX codes, déjà nettoyés.
	 * @return array{ok:bool,rows:array<string,array<string,?int>>,missing:string[],unanswered:string[],error:string,reason:string}
	 */
	private static function ask( array $batch, ?int $timeout = null, bool $retry = true ): array {
		$refusal = static fn( string $error, string $reason ): array => array(
			'ok'         => false,
			'rows'       => array(),
			'missing'    => array(),
			'unanswered' => $batch,
			'error'      => $error,
			'reason'     => $reason,
		);

		$why = SupplyHttp::unconfigured();
		if ( '' !== $why ) {
			return $refusal( $why, 'config' );
		}
		if ( array() === $batch ) {
			return $refusal( 'Aucun code à demander.', 'bad_request' );
		}

		$answer = SupplyHttp::get(
			self::ROUTE,
			array( 'products' => implode( ',', $batch ) ),
			$timeout ?? self::timeout_for( count( $batch ) ),
			$retry
		);

		if ( empty( $answer['ok'] ) ) {
			return $refusal(
				(string) ( $answer['error'] ?? 'Le service prix/stock n’a pas répondu.' ),
				(string) ( $answer['reason'] ?? 'transport' )
			);
		}

		$parsed           = self::parse_rows( (array) ( $answer['body'] ?? array() ), $batch );
		$parsed['reason'] = $parsed['ok'] ? '' : 'parse';

		if ( $parsed['ok'] ) {
			self::write_rows( $parsed['rows'], $parsed['missing'] );
		}

		return $parsed;
	}

	/**
	 * Écrit ce qu'on vient d'apprendre, et rien de plus.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * POURQUOI LES `NULL` SONT DES LITTÉRAUX ET PAS DES `%d`
	 *
	 * `$wpdb->prepare()` transforme un null en 0 pour `%d` et en chaîne vide
	 * pour `%s`. Un prix inconnu écrit par un `%d` deviendrait donc 0 centime,
	 * c'est-à-dire un textile gratuit, dans la table dont le moteur de prix se
	 * sert. C'est le défaut exact que ce fichier passe sa vie à éviter, et il
	 * serait entré par la porte de service. Les colonnes nulles sont donc
	 * écrites comme le mot NULL dans le SQL, jamais comme un paramètre.
	 *
	 * `ON DUPLICATE KEY UPDATE` et un seul aller-retour par lot : sur un
	 * mutualisé, 150 requêtes là où une suffit se paient en temps de page.
	 * `VALUES(col)` et pas la syntaxe à alias de MySQL 8.0.20, parce que
	 * MariaDB, qui est ce que sert l'hébergeur, ne la connaît pas.
	 *
	 * @param array<string,array{cents:?int,stock:?int,stock_supplier:?int,box_qty:?int}> $rows
	 * @param string[]                                                                    $missing
	 * @return int Le nombre de lignes présentées à la base.
	 */
	private static function write_rows( array $rows, array $missing ): int {
		global $wpdb;

		$lines = array();
		foreach ( $rows as $code => $row ) {
			$lines[] = array(
				'code'           => (string) $code,
				'cents'          => $row['cents'] ?? null,
				'stock'          => $row['stock'] ?? null,
				'stock_supplier' => $row['stock_supplier'] ?? null,
				'box_qty'        => $row['box_qty'] ?? null,
				'miss'           => 0,
			);
		}
		/*
		 * UNE ABSENCE EST UN FAIT, ET ELLE EFFACE LES CHIFFRES. Un article que
		 * le fournisseur ne connaît plus garde une ligne (c'est ce qui distingue
		 * « il n'existe pas » de « on n'a jamais demandé ») mais perd son prix
		 * et son stock : les garder ferait afficher « 42 en stock » sous un
		 * article qui n'est plus au catalogue.
		 */
		foreach ( $missing as $code ) {
			$lines[] = array(
				'code'           => (string) $code,
				'cents'          => null,
				'stock'          => null,
				'stock_supplier' => null,
				'box_qty'        => null,
				'miss'           => 1,
			);
		}

		if ( array() === $lines ) {
			return 0;
		}

		$at     = gmdate( 'Y-m-d H:i:s' );
		$tuples = array();
		$args   = array();

		foreach ( $lines as $line ) {
			$slots  = array( '%s' );
			$args[] = $line['code'];
			foreach ( array( 'cents', 'stock', 'stock_supplier', 'box_qty' ) as $column ) {
				if ( null === $line[ $column ] ) {
					$slots[] = 'NULL';
					continue;
				}
				$slots[] = '%d';
				$args[]  = (int) $line[ $column ];
			}
			$slots[]  = '%s';
			$args[]   = $at;
			$slots[]  = '%d';
			$args[]   = (int) $line['miss'];
			$tuples[] = '(' . implode( ', ', $slots ) . ')';
		}

		$sql = 'INSERT INTO ' . self::table()
			. ' (code, cents, stock, stock_supplier, box_qty, checked_at, miss) VALUES '
			. implode( ', ', $tuples )
			. ' ON DUPLICATE KEY UPDATE cents = VALUES(cents), stock = VALUES(stock),'
			. ' stock_supplier = VALUES(stock_supplier), box_qty = VALUES(box_qty),'
			. ' checked_at = VALUES(checked_at), miss = VALUES(miss)';

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query( $wpdb->prepare( $sql, $args ) );

		return count( $lines );
	}

	/**
	 * Rafraîchit la table pour ces codes.
	 *
	 * UN LOT QUI ÉCHOUE NE TOUCHE À RIEN. Il est compté, son motif est rendu, et
	 * les lots suivants continuent : un incident de réseau sur le lot 3 n'a
	 * aucune raison de priver les lots 4 à 12 d'un rafraîchissement. Deux motifs
	 * font exception et arrêtent la marche, `config` et `auth`, parce qu'ils ne
	 * changeront pas d'ici au lot suivant et que les redemander soixante fois
	 * transforme un jeton absent en vingt minutes de silence, ce qui est le
	 * raisonnement que `SupplyHttp::get()` applique déjà à sa propre reprise.
	 *
	 * @param string[] $codes
	 * @return array{ok:bool,asked:int,written:int,missing:string[],error:string}
	 */
	public static function refresh( array $codes ): array {
		$codes = self::clean_codes( $codes );

		$out = array(
			'ok'      => true,
			'asked'   => count( $codes ),
			'written' => 0,
			'missing' => array(),
			'error'   => '',
		);
		if ( array() === $codes ) {
			return $out;
		}

		$batches = self::batches( $codes );
		$failed  = 0;
		$first   = '';

		foreach ( $batches as $batch ) {
			$answer = self::ask( $batch );

			if ( ! $answer['ok'] ) {
				++$failed;
				if ( '' === $first ) {
					$first = (string) $answer['error'];
				}
				if ( in_array( $answer['reason'], array( 'config', 'auth' ), true ) ) {
					break;
				}
				continue;
			}

			$out['written'] += count( $answer['rows'] ) + count( $answer['missing'] );
			$out['missing']  = array_merge( $out['missing'], $answer['missing'] );
		}

		if ( $failed > 0 ) {
			$out['ok']    = false;
			$out['error'] = 1 === $failed
				? $first
				: sprintf( '%d lots sur %d ont échoué. Le premier : %s', $failed, count( $batches ), $first );
		}

		return $out;
	}

	/**
	 * Ce que la table sait, sans parler à personne.
	 *
	 * C'est ce qu'une page de rayon lit. Un code absent du retour n'a JAMAIS été
	 * demandé ; un code présent avec `miss` vrai a été demandé et le fournisseur
	 * a dit qu'il n'existe pas. L'appelant qui confond les deux affiche « rupture
	 * » sur un article qu'on n'a simplement pas encore regardé.
	 *
	 * `at` est l'heure à laquelle NOUS avons demandé, en UTC. Ce n'est pas
	 * `Catalogue::META_STOCK_AT`, qui porte l'horodatage publié par le
	 * fournisseur : sur cette route il n'en publie pas, la réponse est calculée
	 * à la demande, donc l'instant de la demande est l'instant de l'observation.
	 * Les deux champs se ressemblent et ne veulent pas dire la même chose.
	 *
	 * @param string[] $codes
	 * @return array<string,array{cents:?int,stock:?int,stock_supplier:?int,box_qty:?int,at:string,miss:bool}>
	 */
	public static function known( array $codes ): array {
		global $wpdb;

		$codes = self::clean_codes( $codes );
		if ( array() === $codes ) {
			return array();
		}

		$index = array();
		foreach ( $codes as $code ) {
			$index[ strtoupper( $code ) ] = $code;
		}

		$out = array();
		// Cinq cents par requête : une page de rayon n'en demande jamais autant,
		// et un balayage qui en demanderait dix mille ferait un paquet réseau
		// que le serveur MySQL refuserait (`max_allowed_packet`).
		foreach ( array_chunk( $codes, 500 ) as $chunk ) {
			$holes = implode( ', ', array_fill( 0, count( $chunk ), '%s' ) );
			$sql   = 'SELECT code, cents, stock, stock_supplier, box_qty, checked_at, miss FROM '
				. self::table() . ' WHERE code IN (' . $holes . ')';

			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$rows = (array) $wpdb->get_results( $wpdb->prepare( $sql, $chunk ) );

			foreach ( $rows as $row ) {
				$code = (string) $row->code;
				$key  = $index[ strtoupper( $code ) ] ?? $code;

				$out[ $key ] = array(
					'cents'          => null === $row->cents ? null : (int) $row->cents,
					'stock'          => null === $row->stock ? null : (int) $row->stock,
					'stock_supplier' => null === $row->stock_supplier ? null : (int) $row->stock_supplier,
					'box_qty'        => null === $row->box_qty ? null : (int) $row->box_qty,
					'at'             => (string) $row->checked_at,
					'miss'           => 1 === (int) $row->miss,
				);
			}
		}

		return $out;
	}

	/**
	 * LE MOMENT DE VÉRITÉ. Appelé à l'ajout au panier, et de nouveau en caisse.
	 *
	 * IL N'OUVRE JAMAIS LA TABLE. C'est le seul endroit du site où une réponse
	 * d'il y a vingt minutes vend un article qui n'existe plus, et où le client
	 * a déjà payé quand on s'en aperçoit. Il paie donc les 10 s.
	 *
	 * FERMÉ PAR DÉFAUT, dans les sept cas : rien de ce qui n'a pas été confirmé
	 * article par article ne repart avec `ok` à vrai.
	 *
	 * ATTENTION : le retour contient `cents`, qui est notre prix d'achat. Il est
	 * là pour le moteur de prix, côté serveur. Ne le renvoyez pas tel quel dans
	 * une réponse REST ni dans un gabarit.
	 *
	 * @param array<string,int> $wanted code => quantité.
	 * @return array{ok:bool,reason:string,lines:array<string,array{ok:bool,why:string,cents:?int,stock:?int,qty:int,message:string}>,message:string}
	 */
	public static function assert_buyable( array $wanted, int $trust_minutes = 0, array $labels = array() ): array {
		$codes = self::clean_codes( array_keys( $wanted ) );

		if ( array() === $codes ) {
			return array(
				'ok'      => false,
				'reason'  => 'empty',
				'lines'   => array(),
				'message' => 'Aucun article à vérifier.',
			);
		}

		/*
		 * UN PANIER TROP GROS EST REFUSÉ AVANT D'ÊTRE COMMENCÉ. À 0,068 s par
		 * code, 600 articles distincts prennent 43 s : PHP serait tué au milieu,
		 * la commande n'existerait pas et le client verrait une page blanche.
		 * Refuser tout de suite avec une phrase qui dit quoi faire vaut mieux
		 * qu'un demi-passage en caisse. Le plafond est dérivé du modèle mesuré,
		 * pas choisi.
		 */
		$cap = self::assert_cap( self::ASSERT_MAX_SECONDS );
		if ( count( $codes ) > $cap ) {
			return array(
				'ok'      => false,
				'reason'  => 'too_many',
				'lines'   => array(),
				'message' => sprintf(
					'Ce panier contient %s articles différents, plus que les %s que nous pouvons vérifier en une fois. Séparez la commande, ou demandez-nous un devis.',
					Money::number( (float) count( $codes ) ),
					Money::number( (float) $cap )
				),
			);
		}

		$rows        = array();
		$missing     = array();
		$unreachable = array();

		/*
		 * ─────────────────────────────────────────────────────────────────────
		 * LA BORNE EST UNE HORLOGE MURALE SUR TOUTE L'ASSERTION, PAS PAR LOT.
		 *
		 * `ASSERT_MAX_SECONDS` bornait le cas SAIN, déduit du modèle de latence
		 * mesuré. Elle ne bornait rien quand le fournisseur pend, ce qui est
		 * exactement le cas pour lequel le repli de six heures existe. Mesuré en
		 * exécutant les fonctions livrées : au plafond, 281 codes font deux
		 * lots, chacun avec un délai de 20 à 21 s et une reprise, soit
		 * 82 secondes de travailleur PHP bloqué contre une borne annoncée à 20.
		 * `max_execution_time` ne compte pas l'attente sur une socket, donc rien
		 * ne tue la requête.
		 *
		 * Deux déclencheurs anonymes : l'ajout au panier, et un simple
		 * affichage de la caisse (mémorisé 90 s par empreinte de panier, donc
		 * une quantité changée repart). Ni plafond par adresse, ni disjoncteur.
		 *
		 * Ce qui reste des codes quand le temps est dépensé tombe dans
		 * `unreachable`, un état que `verdict()` et le repli traitent déjà : on
		 * ne perd donc pas la sécurité, on cesse seulement de la payer en
		 * travailleurs bloqués.
		 */
		$deadline = microtime( true ) + self::ASSERT_MAX_SECONDS;

		foreach ( self::batches( $codes ) as $batch ) {
			$reste = (int) floor( $deadline - microtime( true ) );
			if ( $reste < 1 ) {
				$unreachable = array_merge( $unreachable, $batch );
				continue;
			}
			/*
			 * PAS DE REPRISE ICI. Un contrôle de panier n'est pas un balayage
			 * de catalogue : la reprise appartient à `refresh()` et `sweep()`,
			 * qui tournent en cron et dont personne n'attend la réponse.
			 */
			$answer = self::ask( $batch, min( $reste, self::timeout_for( count( $batch ) ) ), false );
			if ( ! $answer['ok'] ) {
				$unreachable = array_merge( $unreachable, $batch );
				continue;
			}
			$rows    = array_replace( $rows, $answer['rows'] );
			$missing = array_merge( $missing, $answer['missing'] );
			// `unanswered` n'est versé nulle part exprès : un code dont le
			// service n'a pas parlé n'est ni connu ni introuvable, et
			// `verdict()` le refuse en `no_answer` du seul fait de son absence.
		}

		if ( $trust_minutes > 0 && array() !== $unreachable ) {
			$repli       = self::fallback_rows( $unreachable, $trust_minutes );
			$rows        = array_replace( $repli['rows'], $rows );
			$unreachable = $repli['still_mute'];
		}

		return self::verdict( $wanted, $rows, $missing, $unreachable, $labels );
	}

	/**
	 * Ce que la table sait des codes dont le service n'a pas parlé, s'il est
	 * assez récent pour être encore une observation.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * POURQUOI UNE PANNE DU FOURNISSEUR NE FERME PAS LA BOUTIQUE
	 *
	 * Le réflexe est de refuser : « nous n'avons pas pu demander » n'est pas
	 * « il y en a ». C'est vrai, et c'est ce que fait `verdict()` sans ce
	 * repli. Mais appliqué au STOCK il coûte plus qu'il ne protège, et la
	 * raison tient à ce que la boutique vend.
	 *
	 * Le vêtement nu est acheté APRÈS la commande, avec un délai de plusieurs
	 * jours. La quantité lue à l'instant de la vente n'est donc pas une
	 * réservation : elle est une prévision, qu'un autre acheteur peut consommer
	 * dix minutes plus tard, même quand elle est parfaitement fraîche. Ce que
	 * le contrôle en direct apporte réellement, c'est d'attraper les cas nets
	 * (article retiré du catalogue, stock à zéro) avant que le client paie. Il
	 * n'apporte pas une garantie, et le traiter comme une garantie fait payer
	 * la panne d'un tiers par la fermeture de la caisse.
	 *
	 * TROIS ÉTATS ET PAS DEUX, ce que demande la section 3 de `CLAUDE.md` :
	 *
	 *   le service a répondu             -> on obéit, refus compris ;
	 *   il n'a pas répondu, et la table
	 *   porte une observation récente    -> on s'en sert, et la ligne le dit ;
	 *   il n'a pas répondu, et la table
	 *   ne sait rien ou sait trop vieux  -> ON REFUSE.
	 *
	 * Le troisième est le vrai « nous ne savons pas », et c'est le seul qui
	 * ferme. La fenêtre est un PARAMÈTRE et vaut zéro par défaut : tout
	 * appelant qui ne se prononce pas garde le comportement strict, et les
	 * tests écrits avant ce repli continuent de mesurer ce qu'ils mesuraient.
	 *
	 * UNE LIGNE `miss` N'EST PAS UN REPLI. Le fournisseur a dit que l'article
	 * n'existe pas ; la garder ici la transformerait en disponibilité.
	 *
	 * @param string[] $codes
	 * @return array{rows:array<string,array<string,mixed>>,still_mute:string[]}
	 */
	private static function fallback_rows( array $codes, int $trust_minutes ): array {
		$known = self::known( $codes );
		$limit = time() - ( $trust_minutes * 60 );

		$rows = array();
		$mute = array();
		foreach ( $codes as $code ) {
			$row = $known[ $code ] ?? null;
			$at  = is_array( $row ) ? strtotime( (string) ( $row['at'] ?? '' ) . ' UTC' ) : false;

			if ( ! is_array( $row ) || ! empty( $row['miss'] ) || false === $at || $at < $limit
				|| null === $row['stock'] || null === $row['cents'] ) {
				$mute[] = $code;
				continue;
			}
			$rows[ $code ] = array(
				'cents'          => $row['cents'],
				'stock'          => $row['stock'],
				'stock_supplier' => $row['stock_supplier'],
				'box_qty'        => $row['box_qty'],
			);
		}

		return array(
			'rows'       => $rows,
			'still_mute' => $mute,
		);
	}

	/**
	 * Prix et stock de toutes les déclinaisons d'une référence, en direct.
	 *
	 * Sert l'import et la fiche produit, par la route `/{reference}`, qui rend
	 * une liste. Une référence bien fournie coûte cher : 228 déclinaisons ont été
	 * mesurées à 15,6 s. C'est pour cela qu'aucune page de rayon ne passe par ici.
	 *
	 * UNE LISTE VIDE EST UN ÉCHEC, PAS UN CATALOGUE VIDE. `Supply::to_entry()`
	 * lit `ok` pour décider s'il a le droit de toucher au prix et au stock déjà
	 * en base ; un `ok` complaisant sur zéro ligne effacerait le coût de toutes
	 * les déclinaisons de la référence, ce que le commentaire de ce fichier-là
	 * raconte s'être déjà produit.
	 *
	 * @return array{ok:bool,rows:array<string,array{cents:?int,stock:?int,stock_supplier:?int,box_qty:?int}>,error:string}
	 */
	/**
	 * Prix et stock d'une liste de codes connus, en lots bornés.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * POURQUOI PAS LA ROUTE PAR RÉFÉRENCE, QUAND ON CONNAÎT DÉJÀ LES CODES.
	 *
	 * `for_reference()` fait UN appel qui rend toutes les déclinaisons, et son
	 * délai est dérivé du nombre de déclinaisons de la référence la plus fournie
	 * qu'on avait mesurée : 228. Relevé sur le dépôt complet, la vraie plus
	 * fournie en porte 726, et BC03T en porte 292, mesurée à 20,6 s le
	 * 9 septembre 2026 : l'appel expirait et l'import annonçait « les tarifs
	 * n'ont pas pu être lus », ce qui est vrai, honnête, et évitable.
	 *
	 * À 0,482 s de socle et 0,069 s par code, 726 déclinaisons font 51 s en un
	 * seul appel et 53 s en cinq lots. Le total est le même ; ce qui change est
	 * qu'un lot qui pend coûte un lot et pas la référence entière, et que chaque
	 * délai est dérivé du nombre de codes qu'il porte au lieu d'être un pari.
	 *
	 * L'IMPORT CONNAÎT SES CODES : ils sont dans la charge utile déposée. Cette
	 * méthode existe pour lui ; `for_reference()` reste pour qui ne les a pas.
	 *
	 * @param string[] $codes
	 * @return array{ok:bool,rows:array<string,array<string,mixed>>,error:string}
	 */
	public static function for_codes( array $codes ): array {
		$codes = self::clean_codes( $codes );
		if ( array() === $codes ) {
			return array(
				'ok'    => false,
				'rows'  => array(),
				'error' => 'Aucun code à demander.',
			);
		}

		$rows    = array();
		$erreurs = array();
		foreach ( self::batches( $codes ) as $batch ) {
			$answer = self::ask( $batch );
			if ( ! $answer['ok'] ) {
				$erreurs[] = (string) ( $answer['error'] ?? 'lot en échec' );
				continue;
			}
			$rows = array_replace( $rows, $answer['rows'] );
			self::write_rows( $answer['rows'], $answer['missing'] );
		}

		/*
		 * UN SEUL LOT EN ÉCHEC SUFFIT À REFUSER TOUTE LA RÉFÉRENCE, et ce n'est
		 * pas de la prudence excessive : `Supply::to_entry()` lit `ok` pour
		 * décider s'il a le droit de toucher aux prix déjà en base. Rendre
		 * `ok = true` sur une réponse partielle ferait effacer le coût des
		 * articles du lot manquant, ce que le commentaire de `Catalogue::map()`
		 * raconte s'être déjà produit sur 366 déclinaisons.
		 */
		if ( array() !== $erreurs ) {
			return array(
				'ok'    => false,
				'rows'  => array(),
				'error' => $erreurs[0],
			);
		}

		return array(
			'ok'    => array() !== $rows,
			'rows'  => $rows,
			'error' => array() === $rows ? 'Le service n’a rendu aucune ligne pour ces codes.' : '',
		);
	}

	public static function for_reference( string $ref ): array {
		$ref = trim( $ref );

		if ( ! self::valid_code( $ref ) ) {
			return array(
				'ok'    => false,
				'rows'  => array(),
				'error' => 'La référence « ' . $ref . ' » n’a pas une forme que le service accepte.',
			);
		}

		$why = SupplyHttp::unconfigured();
		if ( '' !== $why ) {
			return array(
				'ok'    => false,
				'rows'  => array(),
				'error' => $why,
			);
		}

		$answer = SupplyHttp::get(
			self::ROUTE . '/' . rawurlencode( $ref ),
			array(),
			// On ne sait pas combien de déclinaisons porte la référence avant de
			// demander. La plus fournie du catalogue en a 228, mesurée à 15,6 s.
			self::timeout_for( 228 )
		);

		if ( empty( $answer['ok'] ) ) {
			return array(
				'ok'    => false,
				'rows'  => array(),
				'error' => (string) ( $answer['error'] ?? 'Le service prix/stock n’a pas répondu.' ),
			);
		}

		// Aucun code attendu : c'est la réponse qui les nomme.
		$parsed = self::parse_rows( (array) ( $answer['body'] ?? array() ), array() );

		if ( ! $parsed['ok'] || array() === $parsed['rows'] ) {
			return array(
				'ok'    => false,
				'rows'  => array(),
				'error' => '' !== $parsed['error']
					? $parsed['error']
					: 'Le service prix/stock n’a rendu aucune déclinaison pour la référence « ' . $ref . ' ».',
			);
		}

		self::write_rows( $parsed['rows'], array() );

		return array(
			'ok'    => true,
			'rows'  => $parsed['rows'],
			'error' => '',
		);
	}

	/**
	 * Une page du stock connu, pour le balayage de `wp teeshoop stock`.
	 *
	 * LIT LA TABLE, PAS LE SERVICE. Le balayage couvre des dizaines de milliers
	 * d'articles, et à 0,068 s par code cela ferait une demi-heure de réseau par
	 * passage. C'est `sweep()` qui paie ce réseau, dans son propre budget.
	 *
	 * LA LIGNE EST `[ code, stock, 0, stock_supplier ]`, dans cet ordre, parce
	 * que `Cli::stock_refresh()` lit la quantité à `Catalogue::STOCK_INDEX + 1`
	 * et que cette constante existe pour que l'indice ne soit pas un 1 écrit à la
	 * main dans deux fichiers.
	 *
	 * DEUX EXCLUSIONS ET UNE INCLUSION, toutes les trois délibérées :
	 *   un `stock` nul (on n'a pas su lire) est EXCLU, parce que le publier à
	 *   zéro inventerait une rupture ;
	 *   une ligne `miss` est INCLUSE à zéro, parce qu'un article que le
	 *   fournisseur ne connaît plus ne doit surtout pas garder son dernier stock,
	 *   sinon la boutique vend ce qu'elle ne peut plus acheter.
	 *
	 * `at` est le plus ANCIEN horodatage de la page et pas le plus récent :
	 * `Cli` l'écrit tel quel sur chaque déclinaison vue, donc prendre le plus
	 * récent ferait passer pour fraîche une observation qui ne l'est pas.
	 *
	 * @return array{ok:bool,error:string,at:string,total:int,rows:array<int,array{0:string,1:int,2:int,3:int}>,next:?int}
	 */
	public static function stock_page( int $offset, int $limit = 4000 ): array {
		global $wpdb;

		$offset = max( 0, $offset );
		$limit  = max( 1, min( 20000, $limit ) );
		$table  = self::table();

		$empty = array(
			'ok'    => true,
			'error' => '',
			'at'    => '',
			'total' => 0,
			'rows'  => array(),
			'next'  => null,
		);

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$total = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table} WHERE stock IS NOT NULL OR miss = 1" );
		if ( 0 === $total ) {
			return $empty;
		}

		// L'ordre est sur la clé primaire : une pagination par décalage sur un
		// ordre instable saute des lignes et en répète d'autres dès qu'une
		// écriture passe entre deux pages, et `sweep()` écrit en permanence.
		$sql = "SELECT code, stock, stock_supplier, miss FROM {$table}"
			. ' WHERE stock IS NOT NULL OR miss = 1 ORDER BY code ASC LIMIT %d OFFSET %d';

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$rows = (array) $wpdb->get_results( $wpdb->prepare( $sql, $limit, $offset ) );
		if ( array() === $rows ) {
			return $empty;
		}

		$codes = array_map( static fn( $r ): string => (string) $r->code, $rows );

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$oldest = (string) $wpdb->get_var(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				"SELECT MIN(checked_at) FROM {$table} WHERE code IN (" . implode( ', ', array_fill( 0, count( $codes ), '%s' ) ) . ')',
				$codes
			)
		);

		/*
		 * SANS HORODATAGE, PAS DE PAGE. `Cli::stock_refresh()` écrit `at` dans
		 * `Catalogue::META_STOCK_AT` sur chaque déclinaison vue, et c'est cette
		 * date qui décide plus tard si le stock affiché est encore affichable.
		 * Retomber sur `gmdate('c')` ferait passer pour observée à l'instant une
		 * page dont on vient justement de ne pas savoir quand elle a été
		 * observée : c'est la seule direction dangereuse, donc on refuse.
		 */
		$seconds = '' === $oldest ? false : strtotime( $oldest . ' UTC' );
		if ( false === $seconds ) {
			return array(
				'ok'    => false,
				'error' => 'La table des disponibilités a rendu des lignes sans date d’observation lisible. Rien n’a été écrit sur le stock.',
				'at'    => '',
				'total' => $total,
				'rows'  => array(),
				'next'  => null,
			);
		}

		$out = array();
		foreach ( $rows as $row ) {
			$miss  = 1 === (int) $row->miss;
			$stock = $miss ? 0 : max( 0, (int) $row->stock );
			$maker = $miss || null === $row->stock_supplier ? 0 : max( 0, (int) $row->stock_supplier );
			$out[] = array( (string) $row->code, $stock, 0, $maker );
		}

		$next = ( $offset + count( $rows ) ) < $total ? $offset + count( $rows ) : null;

		return array(
			'ok'    => true,
			'error' => '',
			'at'    => gmdate( 'c', $seconds ),
			'total' => $total,
			'rows'  => $out,
			'next'  => $next,
		);
	}

	/**
	 * Les codes déjà connus dont l'observation a vieilli, les plus vieux d'abord.
	 *
	 * Ne rend QUE des codes qui ont une ligne. Un article importé dont on n'a
	 * jamais demandé le prix n'apparaît pas ici : c'est `unseen()` qui le trouve,
	 * et `sweep()` qui mélange les deux.
	 *
	 * @return string[]
	 */
	public static function stale( int $limit, int $older_than_minutes ): array {
		global $wpdb;

		$limit  = max( 1, min( 5000, $limit ) );
		$before = gmdate( 'Y-m-d H:i:s', time() - max( 0, $older_than_minutes ) * 60 );

		$sql = 'SELECT code FROM ' . self::table() . ' WHERE checked_at < %s ORDER BY checked_at ASC LIMIT %d';

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return array_map( 'strval', (array) $wpdb->get_col( $wpdb->prepare( $sql, $before, $limit ) ) );
	}

	/**
	 * Les articles importés dont on n'a JAMAIS demandé le prix ni le stock.
	 *
	 * Sans cette moitié, le balayeur ne peut pas s'amorcer : `stale()` ne trouve
	 * que ce qui a déjà une ligne, donc sur une table vide il rendrait toujours
	 * zéro code et le rafraîchissement ne commencerait jamais. Un article jamais
	 * demandé est aussi le plus périmé qui soit, donc il passe devant.
	 *
	 * La jointure marche parce que `install()` prend l'interclassement de la
	 * base (`get_charset_collate()`) : deux interclassements différents entre
	 * `code` et `meta_value` la feraient échouer, ce qui est le défaut que
	 * `Schema.php` documente déjà.
	 *
	 * @return string[]
	 */
	public static function unseen( int $limit ): array {
		global $wpdb;

		$limit = max( 1, min( 5000, $limit ) );
		$table = self::table();

		$sql = "SELECT DISTINCT pm.meta_value FROM {$wpdb->postmeta} pm"
			. " LEFT JOIN {$table} d ON d.code = pm.meta_value"
			. ' WHERE pm.meta_key = %s AND d.code IS NULL AND pm.meta_value <> %s'
			. ' LIMIT %d';

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$codes = (array) $wpdb->get_col( $wpdb->prepare( $sql, Catalogue::META_SUPPLY_SKU, '', $limit ) );

		return self::clean_codes( $codes );
	}

	/**
	 * Le rafraîchisseur périodique, borné par une horloge.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * DEUX GARDES, ET LES DEUX SERVENT
	 *
	 * La PRÉDICTION empêche de commencer un lot qu'on ne pourra pas finir :
	 * `codes_that_fit()` dit combien de codes tiennent dans le temps restant, et
	 * zéro arrête la marche. L'HORLOGE, relue après chaque lot, est ce qui a le
	 * dernier mot : le modèle mesuré sous-estime un lot plein de 0,5 %, et un
	 * mutualisé un mauvais jour fera bien pire que 0,5 %. Le modèle seul
	 * dépasserait `max_execution_time` sans jamais le savoir ; l'horloge seule
	 * couperait un lot au milieu.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * SIX HEURES, ET C'EST UNE HYPOTHÈSE
	 *
	 * Aucune réponse de l'associé ne dit à partir de quel âge un stock affiché
	 * cesse d'être affichable. Six heures est ce que ce fichier suppose, et le
	 * paramètre est là pour que la réponse le change en un endroit. La question
	 * porte à faux de toute façon : ce qui protège une VENTE est
	 * `assert_buyable()`, qui n'ouvre jamais cette table. Cette fraîcheur-là ne
	 * décide que de ce qu'une page annonce avant l'ajout au panier.
	 *
	 * @return array{ok:bool,budget:int,elapsed:float,batches:int,queued:int,asked:int,written:int,missing:int,stopped:string,error:string}
	 */
	public static function sweep( int $budget_seconds = 20, int $older_than_minutes = 360 ): array {
		$budget   = (float) max( 1, min( 3600, $budget_seconds ) );
		$start    = microtime( true );
		$deadline = $start + $budget;

		$out = array(
			'ok'       => true,
			'budget'   => (int) $budget,
			'elapsed'  => 0.0,
			'batches'  => 0,
			'queued'   => 0,
			'asked'    => 0,
			'written'  => 0,
			'missing'  => 0,
			'stopped'  => 'file vide',
			'error'    => '',
		);

		$why = SupplyHttp::unconfigured();
		if ( '' !== $why ) {
			$out['ok']      = false;
			$out['stopped'] = 'non configuré';
			$out['error']   = $why;
			return $out;
		}

		// On ne tire que ce que le budget peut payer : lire dix mille codes pour
		// en traiter deux cents coûte une requête SQL pour rien.
		$want = self::assert_cap( $budget );
		if ( $want < 1 ) {
			$out['stopped'] = 'budget épuisé';
			$out['elapsed'] = round( microtime( true ) - $start, 3 );
			return $out;
		}

		$split = self::queue_split( $want );
		$queue = self::unseen( max( 1, $split['unseen'] ) );
		if ( $split['stale'] > 0 ) {
			$queue = array_merge( $queue, self::stale( $split['stale'], $older_than_minutes ) );
		}
		// La file qui n'a pas rempli sa part rend la place à l'autre : une
		// moitié vide ne doit pas coûter la moitié du passage.
		if ( count( $queue ) < $want ) {
			$queue = array_merge( $queue, self::unseen( $want ) );
		}
		$queue = array_slice( self::clean_codes( $queue ), 0, $want );

		$out['queued'] = count( $queue );

		if ( array() === $queue ) {
			$out['elapsed'] = round( microtime( true ) - $start, 3 );
			return $out;
		}

		$failed = 0;
		$first  = '';

		while ( array() !== $queue ) {
			$room = $deadline - microtime( true );
			$fits = self::codes_that_fit( $room );
			if ( $fits < 1 ) {
				$out['stopped'] = 'budget épuisé';
				break;
			}

			$batch  = array_splice( $queue, 0, $fits );
			$answer = self::ask( $batch );
			++$out['batches'];
			$out['asked'] += count( $batch );

			if ( ! $answer['ok'] ) {
				++$failed;
				if ( '' === $first ) {
					$first = (string) $answer['error'];
				}
				if ( in_array( $answer['reason'], array( 'config', 'auth' ), true ) ) {
					$out['stopped'] = 'refus d’authentification';
					break;
				}
				continue;
			}

			$out['written'] += count( $answer['rows'] ) + count( $answer['missing'] );
			$out['missing'] += count( $answer['missing'] );
		}

		if ( $failed > 0 ) {
			$out['ok']    = false;
			$out['error'] = 1 === $failed ? $first : sprintf( '%d lots ont échoué. Le premier : %s', $failed, $first );
			if ( 'file vide' === $out['stopped'] ) {
				$out['stopped'] = 'erreur';
			}
		}

		$out['elapsed'] = round( microtime( true ) - $start, 3 );
		return $out;
	}
}
