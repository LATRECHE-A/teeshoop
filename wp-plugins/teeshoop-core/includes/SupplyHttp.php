<?php
/**
 * Le transport vers le webservice du fournisseur. Rien d'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER NE NOMME PERSONNE
 *
 * `scripts/php-guard.mjs` refuse tout nom de fournisseur dans ce greffon, et
 * l'adresse du webservice EST un nom : le domaine du nôtre le porte en toutes
 * lettres. Un littéral ici, et le nom part dans la sauvegarde, dans le dépôt,
 * et dans le premier gabarit qui échappe une erreur à l'écran. Les cinq valeurs
 * sont donc des constantes de `wp-config.php`, jamais du code, et la garde
 * mesure que cette règle tient.
 *
 * `Supply::SOURCE` reste la seule identité qui circule : un CODE d'adaptateur
 * (`ws`), pas un nom. Deux fournisseurs peuvent cohabiter dans un catalogue
 * parce que l'article porte l'adaptateur qui l'a écrit, et pas la marque de qui
 * l'a vendu.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LES CINQ PIÈGES DE CE WEBSERVICE, TOUS MESURÉS LE 9 SEPTEMBRE 2026
 *
 * 1. UN JETON FAUX OU ABSENT NE REND PAS 401. Il rend 302 vers une page de
 *    connexion HTML. Un client qui regarde `response.ok` reçoit 200 après
 *    redirection, tente de lire du HTML comme du JSON, et obtient `null`. La
 *    conséquence exacte que `CLAUDE.md` section 3 interdit : « nous n'avons pas
 *    pu demander » devient « il n'y en a pas ». D'où `redirection => 0`, un
 *    3xx traité comme un refus d'authentification, ET l'exigence explicite d'un
 *    `content-type` JSON avant de décoder quoi que ce soit.
 *
 * 2. « INTROUVABLE » EST UN 200. La réponse porte `products_not_found` avec la
 *    liste des références manquantes et un tableau vide. Le code HTTP ne dit
 *    donc rien de l'existence d'un article : seul le corps le dit.
 *
 * 3. AU-DELÀ DE 150 CODES, C'EST UN 502 DE NGINX, pas un 4xx. La limite est
 *    documentée mais pas défendue en amont ; elle est donc défendue ici, et
 *    dépasser n'est pas une erreur qu'on récupère, c'est une erreur qu'on
 *    n'écrit pas.
 *
 * 4. LA SYNTAXE `products[]=a&products[]=b` REND 502 AUSSI. Seule la liste
 *    séparée par des virgules fonctionne. Mesuré deux fois.
 *
 * 5. LE COÛT EST LINÉAIRE EN NOMBRE DE CODES : 0,43 s de socle et 0,068 s par
 *    code (1 code 0,50 s, 150 codes 10,68 s, régression sur sept points). Une
 *    référence à 228 déclinaisons demandée d'un coup a pris 15,6 s. Les délais
 *    ci-dessous en découlent, ils ne sont pas choisis au doigt mouillé.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEUX API, DEUX AUTHENTIFICATIONS
 *
 * Le catalogue et les commandes parlent un jeton porteur fixe. Le service
 * stock/prix de deuxième génération parle OAuth2 `client_credentials` avec un
 * jeton de 24 h. Les deux vivent ici pour qu'il n'y ait qu'un endroit où un
 * refus se lit.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class SupplyHttp {

	/**
	 * Le plafond de codes par appel prix/stock.
	 *
	 * Documenté à 150 par le fournisseur, et mesuré : 150 passe en 10,7 s, 151
	 * rend un 502 nginx. Ce n'est donc pas une politesse, c'est un mur, et le
	 * franchir ne dégrade pas la réponse, il la supprime.
	 */
	public const LIVE_BATCH_MAX = 150;

	/**
	 * Délai d'une requête catalogue, secondes.
	 *
	 * Mesuré : 1,45 s en moyenne par page de 50 produits sur les 65 pages du
	 * catalogue complet, la plus lente à 1,93 s. Trente secondes laissent
	 * quinze fois la marge et bornent quand même une page qui ne revient pas.
	 */
	private const TIMEOUT_CATALOGUE = 30;

	/**
	 * Délai d'un appel prix/stock, secondes.
	 *
	 * 10,7 s mesurés pour un lot plein de 150 codes, 15,6 s pour la référence la
	 * plus fournie du catalogue demandée d'un bloc. Quarante-cinq secondes
	 * couvrent les deux avec de la marge, et restent sous le délai d'exécution
	 * PHP d'un hébergement mutualisé.
	 */
	private const TIMEOUT_LIVE = 45;

	/** Délai d'un appel OAuth2, secondes. Il ne fait qu'échanger deux chaînes. */
	private const TIMEOUT_TOKEN = 15;

	/** Où le jeton OAuth2 dort entre deux appels. */
	private const TOKEN_TRANSIENT = 'teeshoop_supply_token';

	/**
	 * Marge de sécurité sur l'expiration du jeton, secondes.
	 *
	 * Le service annonce 86 400 s. On le jette une heure plus tôt : un jeton qui
	 * expire pendant l'appel qu'il autorise se manifeste par une redirection
	 * vers une page de connexion (piège 1), donc par un refus que rien ne
	 * distingue d'un mauvais identifiant.
	 */
	private const TOKEN_MARGIN = 3600;

	// -----------------------------------------------------------------------
	// La configuration, qui n'est jamais dans ce fichier
	// -----------------------------------------------------------------------

	/**
	 * Une constante définie, non vide, rognée. Sinon ''.
	 *
	 * @param string $name Le nom de la constante.
	 */
	private static function conf( string $name ): string {
		if ( ! defined( $name ) ) {
			return '';
		}
		$value = constant( $name );
		return is_string( $value ) ? trim( $value ) : '';
	}

	/** La base du service catalogue et commandes, sans barre finale. */
	public static function catalogue_base(): string {
		return rtrim( self::conf( 'TEESHOOP_SUPPLY_BASE' ), '/' );
	}

	/**
	 * La valeur complète de l'en-tête `Authorization` du service catalogue.
	 *
	 * Le fournisseur transmet la valeur d'en-tête entière, préfixe compris, et
	 * son jeton contient des caractères (`+`, `#`, `|`, `%`) qu'une
	 * concaténation « Bearer » . $token casserait si quelqu'un décidait un jour
	 * de ne stocker que la partie droite. On stocke ce qui est envoyé, on
	 * envoie ce qui est stocké, et on répare le seul oubli probable : le
	 * préfixe manquant.
	 */
	public static function catalogue_auth(): string {
		$raw = self::conf( 'TEESHOOP_SUPPLY_TOKEN' );
		if ( '' === $raw ) {
			return '';
		}
		return 0 === stripos( $raw, 'bearer ' ) ? $raw : 'Bearer ' . $raw;
	}

	/** La base du service stock/prix de deuxième génération, sans barre finale. */
	public static function live_base(): string {
		return rtrim( self::conf( 'TEESHOOP_SUPPLY_V2_BASE' ), '/' );
	}

	/**
	 * L'hôte qui sert les photographies, sans barre finale.
	 *
	 * Séparé de la base du service parce que les deux diffèrent : mesuré le
	 * 9 septembre 2026, les URL de photographies renvoyées par le service de
	 * préproduction répondent 404 sur leur propre hôte et 200, en JPEG de
	 * 1 Mo, sur l'hôte public. Une image manquante n'est pas une image grise :
	 * `Importer` n'importe alors rien et l'article garde son état vide.
	 */
	public static function media_base(): string {
		return rtrim( self::conf( 'TEESHOOP_SUPPLY_MEDIA_BASE' ), '/' );
	}

	/**
	 * Ce qui manque pour appeler le catalogue, ou '' si rien ne manque.
	 *
	 * Une phrase française que l'appelant imprime et arrête. Aucun appel ne
	 * part à moitié configuré : un jeton vide donnerait la page de connexion du
	 * piège 1, donc un diagnostic faux.
	 */
	public static function unconfigured(): string {
		if ( '' === self::catalogue_base() ) {
			return 'L’adresse du webservice fournisseur n’est pas réglée. Ajoutez define( \'TEESHOOP_SUPPLY_BASE\', \'https://…\' ); dans wp-config.php.';
		}
		if ( '' === self::catalogue_auth() ) {
			return 'Le jeton du webservice fournisseur est absent. Ajoutez define( \'TEESHOOP_SUPPLY_TOKEN\', \'Bearer …\' ); dans wp-config.php.';
		}
		return '';
	}

	/**
	 * Ce qui manque pour appeler le service prix/stock, ou ''.
	 *
	 * Séparé de `unconfigured()` parce que les deux services ont des
	 * identifiants distincts et qu'une boutique peut légitimement avoir l'un
	 * sans l'autre pendant une bascule. Dire « le catalogue est mal réglé »
	 * quand c'est OAuth2 qui manque envoie l'exploitant chercher au mauvais
	 * endroit.
	 */
	public static function live_unconfigured(): string {
		if ( '' === self::live_base() ) {
			return 'L’adresse du service prix/stock n’est pas réglée (TEESHOOP_SUPPLY_V2_BASE).';
		}
		if ( '' === self::conf( 'TEESHOOP_SUPPLY_CLIENT_ID' ) || '' === self::conf( 'TEESHOOP_SUPPLY_CLIENT_SECRET' ) ) {
			return 'Les identifiants OAuth2 du service prix/stock sont absents (TEESHOOP_SUPPLY_CLIENT_ID, TEESHOOP_SUPPLY_CLIENT_SECRET).';
		}
		return '';
	}

	// -----------------------------------------------------------------------
	// La lecture d'une réponse, qui est l'endroit où l'on ferme
	// -----------------------------------------------------------------------

	/**
	 * Transforme une réponse WordPress en verdict, ou en refus motivé.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * L'ORDRE DES TESTS EST LE FOND DE CETTE MÉTHODE
	 *
	 * On regarde le transport, puis la redirection, puis le code, puis le TYPE
	 * DE CONTENU, et seulement alors le corps. Inverser les deux derniers est
	 * précisément le défaut décrit en tête de fichier : le service répond
	 * 302 puis 200 en HTML, `json_decode` rend `null`, et un appelant pressé lit
	 * « aucun produit ». Ici, un corps qui n'est pas annoncé JSON n'est jamais
	 * décodé et le refus dit pourquoi.
	 *
	 * @param \WP_Error|array<string,mixed> $response Ce que `wp_remote_*` a rendu.
	 * @param string                        $what     Le nom de l'appel, pour le message.
	 * @return array{ok:bool,body?:array<mixed>,error?:string,reason?:string,code?:int}
	 */
	private static function read( $response, string $what ): array {
		if ( is_wp_error( $response ) ) {
			return array(
				'ok'     => false,
				'reason' => 'transport',
				'error'  => 'Le webservice fournisseur est injoignable (' . $what . ') : ' . $response->get_error_message(),
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );

		/*
		 * UNE REDIRECTION EST UN REFUS D'AUTHENTIFICATION, PAS UN DÉTOUR.
		 *
		 * Avec `redirection => 0` WordPress ne suit pas, donc on voit le 302 tel
		 * quel. C'est la seule forme sous laquelle ce service annonce « votre
		 * jeton ne vaut rien » : il n'émet jamais de 401 sur ces routes.
		 * Mesuré le 9 septembre 2026 avec un jeton faux, puis sans jeton.
		 */
		if ( $code >= 300 && $code < 400 ) {
			return array(
				'ok'     => false,
				'reason' => 'auth',
				'code'   => $code,
				'error'  => 'Le webservice fournisseur a renvoyé vers sa page de connexion (' . $what . ') : le jeton est refusé ou absent.',
			);
		}

		if ( 401 === $code || 403 === $code ) {
			return array(
				'ok'     => false,
				'reason' => 'auth',
				'code'   => $code,
				'error'  => 'Le webservice fournisseur a refusé nos identifiants (' . $code . ' sur ' . $what . ').',
			);
		}

		if ( 200 !== $code && 201 !== $code && 422 !== $code ) {
			return array(
				'ok'     => false,
				'reason' => $code >= 500 ? 'upstream' : 'bad_request',
				'code'   => $code,
				'error'  => 'Le webservice fournisseur a répondu ' . $code . ' sur ' . $what . '.',
			);
		}

		$type = (string) wp_remote_retrieve_header( $response, 'content-type' );
		if ( false === stripos( $type, 'json' ) ) {
			return array(
				'ok'     => false,
				'reason' => 'parse',
				'code'   => $code,
				'error'  => 'Le webservice fournisseur a répondu du « ' . ( '' === $type ? 'sans type' : $type ) . ' » au lieu de JSON sur ' . $what . ' : c’est la forme que prend un refus d’authentification sur ce service.',
			);
		}

		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $body ) ) {
			return array(
				'ok'     => false,
				'reason' => 'parse',
				'code'   => $code,
				'error'  => 'Réponse illisible du webservice fournisseur sur ' . $what . '.',
			);
		}

		return array(
			'ok'   => true,
			'code' => $code,
			'body' => $body,
		);
	}

	// -----------------------------------------------------------------------
	// Les trois verbes
	// -----------------------------------------------------------------------

	/**
	 * Un GET sur le service catalogue.
	 *
	 * REPRIS UNE FOIS, et seulement sur une panne de transport ou un 5xx. Un
	 * 302 ne deviendra pas un 200 en le redemandant, et une marche du catalogue
	 * qui réessaie trois fois chaque refus transforme un mauvais jeton en vingt
	 * minutes de silence.
	 *
	 * @param string               $path    Chemin relatif à la base, commençant par une barre.
	 * @param array<string,scalar> $query   Paramètres.
	 * @param int|null             $timeout Délai, secondes. Défaut : le délai catalogue.
	 * @return array{ok:bool,body?:array<mixed>,error?:string,reason?:string,code?:int}
	 */
	public static function get( string $path, array $query = array(), ?int $timeout = null ): array {
		$why = self::unconfigured();
		if ( '' !== $why ) {
			return array(
				'ok'     => false,
				'reason' => 'config',
				'error'  => $why,
			);
		}

		$url = self::catalogue_base() . $path;
		if ( array() !== $query ) {
			$url = add_query_arg( array_map( 'strval', $query ), $url );
		}

		$args = array(
			'timeout'     => $timeout ?? self::TIMEOUT_CATALOGUE,
			'redirection' => 0,
			'headers'     => array(
				'accept'        => 'application/json',
				'authorization' => self::catalogue_auth(),
			),
		);

		$last = array();
		for ( $attempt = 0; $attempt < 2; $attempt++ ) {
			$last = self::read( wp_remote_get( $url, $args ), $path );
			if ( $last['ok'] ) {
				return $last;
			}
			$reason = (string) ( $last['reason'] ?? '' );
			if ( 'transport' !== $reason && 'upstream' !== $reason ) {
				return $last;
			}
		}
		return $last;
	}

	/**
	 * Un GET sur le service prix/stock, porté par le jeton OAuth2.
	 *
	 * @param string               $path    Chemin relatif à la base v2.
	 * @param array<string,scalar> $query   Paramètres.
	 * @return array{ok:bool,body?:array<mixed>,error?:string,reason?:string,code?:int}
	 */
	public static function get_live( string $path, array $query = array() ): array {
		$why = self::live_unconfigured();
		if ( '' !== $why ) {
			return array(
				'ok'     => false,
				'reason' => 'config',
				'error'  => $why,
			);
		}

		$token = self::oauth_token();
		if ( '' === $token['token'] ) {
			return array(
				'ok'     => false,
				'reason' => 'auth',
				'error'  => $token['error'],
			);
		}

		$url = self::live_base() . $path;
		if ( array() !== $query ) {
			$url = add_query_arg( array_map( 'strval', $query ), $url );
		}

		return self::read(
			wp_remote_get(
				$url,
				array(
					'timeout'     => self::TIMEOUT_LIVE,
					'redirection' => 0,
					'headers'     => array(
						'accept'        => 'application/json',
						'authorization' => 'Bearer ' . $token['token'],
					),
				)
			),
			$path
		);
	}

	/**
	 * Un POST JSON sur le service catalogue.
	 *
	 * JAMAIS REPRIS, À AUCUN NIVEAU. La seule route POST de ce service crée une
	 * commande fournisseur : une seconde tentative produit une seconde
	 * livraison, et le silence de la première n'est pas la preuve qu'elle n'est
	 * pas arrivée. `Supply::place_order` porte la même règle et la même raison.
	 *
	 * @param string             $path Chemin relatif à la base.
	 * @param array<string,mixed> $body Le corps.
	 * @return array{ok:bool,body?:array<mixed>,error?:string,reason?:string,code?:int}
	 */
	public static function post_json( string $path, array $body ): array {
		$why = self::unconfigured();
		if ( '' !== $why ) {
			return array(
				'ok'     => false,
				'reason' => 'config',
				'error'  => $why,
			);
		}

		return self::read(
			wp_remote_post(
				self::catalogue_base() . $path,
				array(
					'timeout'     => self::TIMEOUT_LIVE,
					'redirection' => 0,
					'headers'     => array(
						'accept'        => 'application/json',
						'content-type'  => 'application/json',
						'authorization' => self::catalogue_auth(),
					),
					'body'        => (string) wp_json_encode( $body ),
				)
			),
			$path
		);
	}

	// -----------------------------------------------------------------------
	// OAuth2
	// -----------------------------------------------------------------------

	/**
	 * Le jeton `client_credentials`, gardé au chaud.
	 *
	 * Le service en délivre un de 86 400 s. Le redemander à chaque appel est
	 * une seconde requête pour chaque requête, sur un service dont on a mesuré
	 * que la latence est déjà le facteur limitant. Il dort donc dans un
	 * transient, expiré une heure avant l'heure (`TOKEN_MARGIN`) pour qu'il ne
	 * meure jamais pendant l'appel qu'il autorise.
	 *
	 * @return array{token:string,error:string}
	 */
	public static function oauth_token(): array {
		$cached = get_transient( self::TOKEN_TRANSIENT );
		if ( is_string( $cached ) && '' !== $cached ) {
			return array(
				'token' => $cached,
				'error' => '',
			);
		}

		$response = wp_remote_post(
			self::live_base() . '/oauth/token',
			array(
				'timeout'     => self::TIMEOUT_TOKEN,
				'redirection' => 0,
				'headers'     => array( 'accept' => 'application/json' ),
				'body'        => array(
					'grant_type'    => 'client_credentials',
					'client_id'     => self::conf( 'TEESHOOP_SUPPLY_CLIENT_ID' ),
					'client_secret' => self::conf( 'TEESHOOP_SUPPLY_CLIENT_SECRET' ),
				),
			)
		);

		$read = self::read( $response, 'oauth/token' );
		if ( ! $read['ok'] ) {
			return array(
				'token' => '',
				'error' => (string) $read['error'],
			);
		}

		$token = (string) ( $read['body']['access_token'] ?? '' );
		if ( '' === $token ) {
			return array(
				'token' => '',
				'error' => 'Le service prix/stock a répondu sans jeton d’accès.',
			);
		}

		$life = (int) ( $read['body']['expires_in'] ?? 0 );
		/*
		 * UNE DURÉE DE VIE ABSENTE OU COURTE NE DEVIENT PAS UNE LONGUE.
		 *
		 * `max( 60, … )` et pas `?: 86400` : si le service raccourcit un jour la
		 * validité, écrire notre propre supposition par-dessus rendrait le jeton
		 * mort et le cache convaincu du contraire, ce qui est le seul état d'où
		 * l'on ne se relève pas tout seul.
		 */
		set_transient( self::TOKEN_TRANSIENT, $token, max( 60, $life - self::TOKEN_MARGIN ) );

		return array(
			'token' => $token,
			'error' => '',
		);
	}

	/** Jette le jeton en cache. Appelé quand le service le refuse malgré tout. */
	public static function forget_token(): void {
		delete_transient( self::TOKEN_TRANSIENT );
	}

	// -----------------------------------------------------------------------
	// Les photographies
	// -----------------------------------------------------------------------

	/**
	 * L'URL d'une photographie, réécrite vers l'hôte qui les sert vraiment.
	 *
	 * Le service de préproduction publie ses images sur son propre domaine, où
	 * elles répondent 404 ; les mêmes chemins répondent 200 sur l'hôte public.
	 * Mesuré le 9 septembre 2026 sur huit URL tirées au sort : huit 404 d'un
	 * côté, trois JPEG de 1 Mo de l'autre. La réécriture est donc une
	 * correction d'environnement, pas une préférence, et elle ne s'applique que
	 * si `TEESHOOP_SUPPLY_MEDIA_BASE` est réglée : sans réglage on rend l'URL
	 * telle quelle plutôt que d'en inventer une.
	 *
	 * Rend '' pour tout ce qui n'est pas une URL http(s) absolue : une chaîne
	 * vide se voit à l'import et laisse l'état vide, alors qu'un chemin bancal
	 * se découvre en production sur une fiche produit.
	 *
	 * @param string $url L'URL publiée par le fournisseur.
	 */
	public static function media_url( string $url ): string {
		$url = trim( $url );
		if ( '' === $url ) {
			return '';
		}
		/*
		 * `parse_url` ET NON `wp_parse_url`, parce que cette méthode est PURE.
		 *
		 * `Supply::to_entry()` l'appelle sur chaque photographie, et
		 * `tests/run.php` exécute cette cartographie SANS WordPress : c'est la
		 * règle de ce greffon, et c'est ce qui fait que la cartographie est
		 * testée contre de vraies charges utiles. `wp_parse_url` n'y existe pas.
		 * Il n'apporte ici qu'une compatibilité PHP 5.4 avec les URL sans
		 * schéma, et une URL sans schéma est justement refusée deux lignes plus
		 * bas.
		 */
		$parts = parse_url( $url );
		if ( ! is_array( $parts ) || ! isset( $parts['scheme'], $parts['host'], $parts['path'] ) ) {
			return '';
		}
		if ( ! in_array( strtolower( (string) $parts['scheme'] ), array( 'http', 'https' ), true ) ) {
			return '';
		}

		$base = self::media_base();
		if ( '' === $base ) {
			return $url;
		}

		$path = (string) $parts['path'];
		return $base . ( str_starts_with( $path, '/' ) ? $path : '/' . $path );
	}
}
