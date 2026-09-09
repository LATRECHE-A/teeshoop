<?php
/**
 * L'atelier : le personnalisateur en pleine page, à son adresse, sur la boutique.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UN DOCUMENT DIT LE CONTRAIRE, IL FAUT LE LIRE AVANT CE FICHIER
 *
 * `docs/decisions/2026-09-05-le-personnalisateur-est-dans-la-page.md` et
 * `includes/Editeur.php` défendent un personnalisateur INTÉGRÉ à la fiche
 * produit, avec six raisons numérotées et une table de mesures. Quelqu'un qui
 * trouve ce fichier trouvera ce document, et il doit trouver la réponse ici,
 * pas la deviner.
 *
 * LES SIX RAISONS SONT TOUJOURS VRAIES. Aucune n'est retirée, aucune n'est
 * réfutée, et `scripts/editeur-guard.mjs` continue de les mesurer. Elles
 * décrivent ce que coûtait UNE application React servie en croisé par un Worker
 * Cloudflare, dans un CADRE, ouverte sur un dessin d'exemple, dont les fichiers
 * vivaient dans un stockage tiers partitionné, et qui devenait muette quand le
 * Worker tombait :
 *
 *   1. la remise à zéro non préfixée de Tailwind réécrivait les éléments du thème
 *   2. `body{overflow:hidden}` et `100dvh` tuaient le défilement du site
 *   3. environ 53 Mo d'actifs en chemins absolus
 *   4. les fenêtres `position:fixed` entraient en collision avec Elementor
 *   5. trois écouteurs clavier globaux avalaient les frappes
 *   6. les singletons de niveau module n'autorisaient qu'une instance
 *
 * AUCUNE N'EST UNE PROPRIÉTÉ DE « UN PERSONNALISATEUR À SON ADRESSE ». Ce sont
 * des propriétés d'un paquet et d'un mode de service. Cette page-ci est servie
 * par WordPress, en MÊME ORIGINE, elle monte le MÊME paquet natif que la fiche
 * produit (`assets/editeur/`, celui que la garde mesure), elle tient son propre
 * nonce REST, et elle s'ouvre sur le produit que le client vient de cliquer,
 * parce que c'est WordPress lui-même qui l'a résolu par son permalien. Les six
 * réponses écrites dans `src/native/main.ts` valent mot pour mot ici : le
 * paquet est le même.
 *
 * Ce que la fiche produit ne peut pas donner et que celle-ci donne :
 *
 *   LA LARGEUR. Le canevas est l'outil. Dans une fente d'ajout au panier, entre
 *   une colonne de photographies et un encadré de prix, il reçoit ce qui reste.
 *   Ici il reçoit la page.
 *
 *   UN PARCOURS EN DEUX TEMPS. « Je regarde ce produit » et « je fabrique mon
 *   marquage » sont deux intentions, et la seconde mérite un écran qui ne
 *   demande rien d'autre. Le drapeau `atelier` du contexte est ce qui permet à
 *   l'éditeur de le savoir.
 *
 *   UNE ADRESSE. `/personnaliser/{produit}/` se met en favori, se rouvre, se
 *   partage avec le collègue qui valide le logo. Un bloc au milieu d'une fiche
 *   n'a pas d'adresse.
 *
 * CE FICHIER NE REMPLACE PAS `Editeur.php` ET N'EN COPIE RIEN. Il réutilise
 * `Editeur::enqueue()` pour les actifs et le contexte, et `Editeur::rendre()`
 * pour le point de montage. Deux implémentations de « ce que la boutique remet
 * à l'éditeur » divergeraient, et le jour où elles divergent le client voit un
 * nuancier et le panier en calcule un autre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IL N'Y A PAS UN PRIX DANS CE FICHIER
 *
 * `Pricing.php` est l'autorité et l'éditeur demande `GET /wp-json/teeshoop/v1/quote`
 * exactement comme il le fait dans la fiche produit. Cette page ne calcule, ne
 * arrondit et n'affiche aucun montant.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Atelier {

	/**
	 * La variable d'interrogation que la règle de réécriture pose.
	 *
	 * Elle vaut « 1 » quand la jolie adresse a résolu le produit par son
	 * identifiant d'URL, et l'identifiant NUMÉRIQUE du produit quand elle est
	 * écrite à la main en permaliens simples. `resolve()` distingue les deux
	 * sans magie : la seconde forme n'agit que si rien d'autre n'a désigné un
	 * article.
	 */
	public const QUERY_VAR = 'teeshoop_atelier';

	/** Le premier segment de l'adresse. Français, comme le reste du catalogue. */
	public const BASE = 'personnaliser';

	/** L'ancre du canevas, cible du lien d'évitement et du `tabindex="-1"`. */
	public const ANCRE = 'atelier-canevas';

	/** La poignée du script qui ajoute les trois clés au contexte. */
	private const HANDLE = 'teeshoop-atelier';

	/**
	 * La forme des règles de réécriture, et le SEUL déclencheur d'un vidage.
	 *
	 * ── POURQUOI PAS `flush_rewrite_rules()` À CHAQUE CHARGEMENT ──────────────
	 *
	 * Parce que c'est une écriture dans `wp_options` sur chaque requête d'une
	 * boutique en hébergement mutualisé, et que la recette traîne dans la
	 * moitié des tutoriels. Parce que ce n'est pas non plus « au crochet
	 * d'activation seulement » : un déploiement qui remplace le répertoire du
	 * greffon par rsync n'active rien, donc la règle n'existerait jamais sur la
	 * production. Le numéro ci-dessous répond aux deux : l'option est absente
	 * après une activation ET après un premier déploiement, le vidage a lieu
	 * une fois, et il a lieu de nouveau le jour où quelqu'un change la forme de
	 * la règle et incrémente ce numéro.
	 */
	private const OPTION_REGLES  = 'teeshoop_atelier_regles';
	private const VERSION_REGLES = '1';

	public static function init(): void {
		add_filter( 'query_vars', array( self::class, 'query_vars' ) );
		add_filter( 'request', array( self::class, 'resolve' ) );
		add_action( 'init', array( self::class, 'register_rules' ) );

		/*
		 * 20, donc APRÈS `wc_template_redirect` (10), qui fait ses propres
		 * redirections de boutique, et après `Seo::first_page` (5) et
		 * `Seo::english_base` (6). Une page qui sort du flux normal doit sortir
		 * en dernier, sinon elle court-circuite des règles qui ont raison.
		 */
		add_action( 'template_redirect', array( self::class, 'serve' ), 20 );

		/*
		 * `wp_enqueue_scripts` et non `wp`, parce que `teeshoop-components` est
		 * ENREGISTRÉ à la priorité 0 de ce crochet et que `wp_add_inline_style`
		 * échoue en silence sur une poignée non enregistrée. 20 laisse passer
		 * `ProductPage::take_over()`, qui a déjà mis l'éditeur en file s'il le
		 * devait.
		 */
		add_action( 'wp_enqueue_scripts', array( self::class, 'assets' ), 20 );

		// 25 : après `ProductPage::robots` (10) et `Seo::robots` (20), avant
		// `Seo::observe` (PHP_INT_MAX) qui lit la réponse finale.
		add_filter( 'wp_robots', array( self::class, 'robots' ), 25 );
	}

	// -----------------------------------------------------------------------
	// L'adresse
	// -----------------------------------------------------------------------

	/**
	 * La règle, écrite en deux morceaux pour qu'un test puisse les lire.
	 *
	 * ── ELLE REND LA MAIN À WORDPRESS, ET C'EST LE POINT ─────────────────────
	 *
	 * La cible n'est pas une page virtuelle : c'est la requête d'un produit,
	 * résolu par son identifiant d'URL, avec un drapeau à côté. WordPress fait
	 * donc lui-même tout ce qu'il sait faire : un identifiant qui ne correspond
	 * à rien rend un vrai 404, un produit en brouillon rend un 404 pour un
	 * visiteur, `get_queried_object_id()` rend le bon article, et
	 * `Editeur::enqueue()`, qui lit exactement cet appel, fonctionne sans
	 * savoir qu'il est sur une autre adresse. Une page virtuelle nous aurait
	 * obligés à réécrire ces quatre comportements, donc à en avoir une seconde
	 * implémentation.
	 */
	public static function rewrite_regex(): string {
		return '^' . self::BASE . '/([^/]+)/?$';
	}

	/** @see rewrite_regex() */
	public static function rewrite_target(): string {
		return 'index.php?post_type=product&product=$matches[1]&' . self::QUERY_VAR . '=1';
	}

	public static function register_rules(): void {
		add_rewrite_rule( self::rewrite_regex(), self::rewrite_target(), 'top' );

		if ( self::VERSION_REGLES === (string) get_option( self::OPTION_REGLES, '' ) ) {
			return;
		}

		/*
		 * VIDAGE DOUX (`false`) : on ne réécrit pas le `.htaccess`. Sur o2switch
		 * il redirige déjà tout vers `index.php`, il est partagé avec le fichier
		 * de sécurité du greffon, et un greffon qui réécrit le `.htaccess` de la
		 * boutique pour ajouter UNE règle interne est un greffon qui peut casser
		 * la boutique entière.
		 */
		flush_rewrite_rules( false );
		update_option( self::OPTION_REGLES, self::VERSION_REGLES, true );
	}

	/**
	 * @param array<int,string> $vars
	 * @return array<int,string>
	 */
	public static function query_vars( $vars ): array {
		if ( ! is_array( $vars ) ) {
			return array( self::QUERY_VAR );
		}
		$vars[] = self::QUERY_VAR;
		return $vars;
	}

	/**
	 * Le repli laid, pour une boutique en permaliens simples.
	 *
	 * ── POURQUOI IL EXISTE ───────────────────────────────────────────────────
	 *
	 * En permaliens simples, aucune règle de réécriture n'est consultée : la
	 * jolie adresse rend 404 et rien ne le dit. Le miroir local a tourné en
	 * permaliens simples pendant des semaines et c'est précisément la
	 * configuration qui avait laissé passer un ajout au panier cassé en
	 * production (voir `Rest::add_to_cart`). Une adresse qui n'existe que sous
	 * une option d'affichage est une panne qui attend un opérateur.
	 *
	 * ── ET POURQUOI IL NE PEUT PAS OUVRIR PLUS QUE LA JOLIE ADRESSE ──────────
	 *
	 * `post_type` est forcé à `product`. Un identifiant qui désigne une page,
	 * un article ou une commande ne correspond alors à rien et rend 404 :
	 * l'atelier ne devient pas une visionneuse universelle par numéro. Et rien
	 * n'est fait si la requête désigne déjà quelque chose, pour que la jolie
	 * adresse ne soit jamais réinterprétée.
	 *
	 * PURE : aucun appel à WordPress, testée par `tests/test-atelier.php`.
	 *
	 * @param array<string,mixed> $vars
	 * @return array<string,mixed>
	 */
	public static function resolve( $vars ): array {
		if ( ! is_array( $vars ) || ! isset( $vars[ self::QUERY_VAR ] ) ) {
			return is_array( $vars ) ? $vars : array();
		}

		// Un tableau ou un objet dans la valeur n'est pas un identifiant. On ne
		// devine pas, on ne touche à rien.
		if ( ! is_scalar( $vars[ self::QUERY_VAR ] ) ) {
			return $vars;
		}

		// La jolie adresse a déjà nommé l'article : ne rien réinterpréter.
		foreach ( array( 'product', 'name', 'p', 'page_id', 'pagename' ) as $deja ) {
			if ( ! empty( $vars[ $deja ] ) ) {
				return $vars;
			}
		}

		/*
		 * UNE SUITE DE CHIFFRES, ET RIEN D'AUTRE.
		 *
		 * `(int)` seul accepte trop : sous PHP 8, `(int) '3.9e2'` vaut 390 et
		 * `(int) ' 12'` vaut 12. Une valeur écrite à la main qui se transforme
		 * en un autre article que celui qu'elle nomme est exactement le genre
		 * de conversion silencieuse que ce projet refuse. `ctype_digit` répond
		 * oui ou non ; « 0 » passe ce filtre et se fait refuser une ligne plus
		 * bas, ce qui est le bon ordre.
		 *
		 * PAS DE `trim()` NON PLUS : aucune adresse écrite par `url()` ne porte
		 * d'espace, donc une valeur qui en porte ne vient pas de nous, et la
		 * nettoyer serait deviner ce qu'elle voulait dire.
		 */
		$brut = (string) $vars[ self::QUERY_VAR ];
		if ( '' === $brut || ! ctype_digit( $brut ) ) {
			return $vars;
		}

		$id = (int) $brut;
		if ( $id <= 0 ) {
			return $vars;
		}

		$vars['p']         = $id;
		$vars['post_type'] = 'product';
		return $vars;
	}

	/**
	 * Le chemin de l'atelier pour un identifiant d'URL, ou '' s'il n'en est pas un.
	 *
	 * REFUSE PLUTÔT QUE DE RÉPARER. Un identifiant d'URL WordPress passé par
	 * `sanitize_title()` ne contient que des lettres sans accent, des chiffres,
	 * `-`, `_`, `.`, `~` et des séquences `%xx` pour les accents. Tout le reste
	 * (une barre oblique, un `?`, un `#`, une espace, un `..`) veut dire que la
	 * valeur ne vient pas de là où on croit, et une adresse fabriquée à partir
	 * d'une valeur qu'on ne sait pas lire est une adresse qui mène ailleurs.
	 *
	 * PURE.
	 */
	public static function path_for( string $slug ): string {
		/*
		 * `\z` ET PAS `$`. En PCRE, `$` accepte un saut de ligne final : le
		 * motif fermé par `$` a laissé passer « tee\n » et rendu une adresse
		 * coupée en deux lignes. Trouvé par le test de ce fichier, à
		 * l'assertion « un retour à la ligne », avant le premier commit.
		 */
		if ( 1 !== preg_match( '#^[A-Za-z0-9._~%-]+\z#', $slug ) ) {
			return '';
		}
		return self::BASE . '/' . $slug . '/';
	}

	/**
	 * L'adresse de l'atelier d'un produit, jolie si la boutique l'est.
	 *
	 * C'est le seul endroit qui compose cette adresse. Ce qui la met dans une
	 * page (la fiche produit, une vignette de catalogue, un e-mail) l'appelle.
	 */
	public static function url( int $product_id ): string {
		if ( $product_id <= 0 ) {
			return '';
		}

		$chemin = self::path_for( (string) get_post_field( 'post_name', $product_id ) );
		if ( '' !== $chemin && '' !== (string) get_option( 'permalink_structure', '' ) ) {
			return home_url( '/' . $chemin );
		}

		return add_query_arg( self::QUERY_VAR, (string) $product_id, home_url( '/' ) );
	}

	/** Cette requête est-elle celle de l'atelier. */
	public static function is_request(): bool {
		return '' !== (string) get_query_var( self::QUERY_VAR, '' );
	}

	// -----------------------------------------------------------------------
	// L'état de la page
	// -----------------------------------------------------------------------

	/**
	 * Ce que cette page peut faire pour ce produit.
	 *
	 * Quatre états, quatre écrans, et aucun d'eux n'est une page blanche.
	 *
	 *   pret           tout est là, l'éditeur monte
	 *   sans-vetement  l'article ne déclare aucun vêtement : `Cart::add`
	 *                  refuserait la ligne, donc personne ne dessine pour rien
	 *   indisponible   l'article n'est pas achetable. `ProductPage::may_quote()`
	 *                  pose déjà la même question sur la fiche, et pour la même
	 *                  raison : un prix annoncé est une offre, et un article que
	 *                  `Gamme::retire()` a sorti de la vente n'en fait pas. Sans
	 *                  ce refus, l'atelier serait le chemin qui contourne la
	 *                  règle : un client dessinerait, téléverserait, et se
	 *                  ferait refuser par la caisse après le travail.
	 *   sans-paquet    le paquet construit de l'éditeur est absent du greffon.
	 *                  « Le fichier n'est pas là » et « le client n'a rien
	 *                  posé » sont deux états, et seul le premier est une panne.
	 */
	public static function etat( int $product_id ): string {
		if ( '' === Product::garment_of( $product_id ) ) {
			return 'sans-vetement';
		}

		$product = function_exists( 'wc_get_product' ) ? wc_get_product( $product_id ) : null;
		if ( ! $product instanceof \WC_Product || ! $product->is_purchasable() ) {
			return 'indisponible';
		}

		if ( ! Editeur::paquet_present() ) {
			return 'sans-paquet';
		}

		return 'pret';
	}

	// -----------------------------------------------------------------------
	// Le rendu
	// -----------------------------------------------------------------------

	/**
	 * La page, à travers la convention de gabarits du greffon.
	 *
	 * `wc_get_template( 'teeshoop/…' , …, TEESHOOP_CORE_DIR . 'templates/' )`
	 * est ce que `ProductPage` fait pour ses quatre blocs : un thème peut donc
	 * poser sa version dans `montheme/teeshoop/atelier.php`, et l'ensemble des
	 * fichiers capables de laisser fuir un coût d'achat reste fini et
	 * greppable (`scripts/php-guard.mjs` scanne `templates/`).
	 *
	 * `exit` APRÈS, parce que `template_redirect` ne sait pas dire « j'ai
	 * répondu » autrement : sans lui, WordPress inclurait ensuite le gabarit du
	 * thème et la page sortirait deux fois. Les fonctions de fin de requête
	 * enregistrées par WordPress tournent quand même.
	 *
	 * RIEN N'EST FAIT SI LA REQUÊTE N'EST PAS SINGULIÈRE. Un identifiant d'URL
	 * qui ne correspond à aucun produit a déjà donné un 404 à WordPress, et
	 * c'est sa page 404, celle du thème, celle que le reste du site utilise,
	 * qui doit répondre. Écrire la nôtre serait une seconde page d'erreur qui
	 * ne ressemble à rien d'autre sur la boutique.
	 */
	public static function serve(): void {
		if ( ! self::is_request() || ! is_singular( 'product' ) ) {
			return;
		}

		$product_id = (int) get_queried_object_id();
		$produit    = (string) get_permalink( $product_id );

		wc_get_template(
			'teeshoop/atelier.php',
			array(
				'etat'        => self::etat( $product_id ),
				'product_id'  => $product_id,
				'titre'       => (string) get_the_title( $product_id ),
				'produit_url' => $produit,
				// L'ancre du formulaire de devis de la fiche produit
				// (`templates/teeshoop/product-quote.php`). Une adresse
				// complète et pas « #teeshoop-devis » : ce formulaire n'est pas
				// sur cette page-ci.
				'devis_url'   => '' !== $produit ? $produit . '#teeshoop-devis' : '',
				'ancre'       => self::ANCRE,
			),
			'',
			TEESHOOP_CORE_DIR . 'templates/'
		);
		exit;
	}

	// -----------------------------------------------------------------------
	// Les actifs et les trois clés
	// -----------------------------------------------------------------------

	public static function assets(): void {
		if ( ! self::is_request() || ! is_singular( 'product' ) ) {
			return;
		}

		/*
		 * LA FICHE PRODUIT A DÉJÀ MIS SES ACTIFS EN FILE, ET CETTE PAGE N'EN A
		 * AUCUN USAGE. `assets/product.js` pilote l'estimateur
		 * (`[data-teeshoop-buy]`) et synchronise le formulaire de devis
		 * (`.ts-devis__form`) ; ce gabarit ne rend ni l'un ni l'autre, donc le
		 * script s'arrête à sa première recherche et la feuille ne trouve aucun
		 * de ses sélecteurs. 12 658 et 13 345 octets non compressés, sur la
		 * page dont tout l'intérêt est le canevas, sur un téléphone.
		 */
		wp_dequeue_script( 'teeshoop-product' );
		wp_dequeue_style( 'teeshoop-product' );

		/*
		 * `teeshoop-components` porte `.ts-cta`, la seule commande dessinée de
		 * cette page. Il dépend de `teeshoop-tokens`, donc la palette mesurée
		 * de la boutique arrive avec, et rien n'est redéclaré ici :
		 * `scripts/palette-guard.mjs` compte déjà trois copies de ces couleurs
		 * et il n'en faut pas une quatrième.
		 */
		wp_enqueue_style( 'teeshoop-components' );
		wp_add_inline_style( 'teeshoop-components', self::css() );

		if ( 'pret' !== self::etat( (int) get_queried_object_id() ) ) {
			return;
		}

		/*
		 * UN SEUL ENDROIT DÉCIDE DE CE QUE LA BOUTIQUE REMET À L'ÉDITEUR.
		 *
		 * `Editeur::enqueue()` met en file la feuille, le module et le contexte
		 * complet. `ProductPage::take_over()` l'appelle déjà quand il estime
		 * que la fiche peut vendre ; on ne l'appelle donc que s'il ne l'a pas
		 * fait, sinon `wp_localize_script` écrirait une SECONDE déclaration de
		 * `TEESHOOP_EDITEUR` dans la page (il concatène, il ne remplace pas).
		 */
		if ( ! wp_script_is( 'teeshoop-editeur', 'enqueued' ) ) {
			Editeur::enqueue();
		}

		/*
		 * LES TROIS CLÉS EN PLUS, SUR UNE AUTRE POIGNÉE, ET IL Y A DEUX RAISONS.
		 *
		 * 1. `Editeur::balise_module()` filtre `script_loader_tag` et RECONSTRUIT
		 *    la balise de sa poignée de zéro. Le `$tag` qu'il reçoit contient
		 *    déjà les scripts en ligne « before » et « after » de WordPress, et
		 *    il les jette. Un `wp_add_inline_script( 'teeshoop-editeur', … )`
		 *    disparaîtrait donc sans un mot. Vérifié dans
		 *    `wp-includes/class-wp-scripts.php` du miroir : `do_item()` compose
		 *    `$tag = $translations . $before_script . <script> . $after_script`
		 *    avant d'appeler le filtre.
		 *
		 * 2. `wp_localize_script` fait passer TOUT par une chaîne de caractères,
		 *    et `src/native/contexte.ts` existe entièrement pour reconvertir
		 *    derrière. Un `true` en ressortirait « 1 ». Ici l'objet est écrit
		 *    par `wp_json_encode`, donc `atelier` arrive en booléen et l'éditeur
		 *    n'a rien à interpréter.
		 *
		 * L'ORDRE EST GARANTI, ET IL FAUT LE DIRE PARCE QU'IL N'EST PAS ÉVIDENT.
		 * WordPress imprime d'abord la donnée localisée, puis la balise du
		 * module, puis ce script-ci (la dépendance le place après). Un script en
		 * ligne classique s'exécute au moment où l'analyseur le rencontre, alors
		 * qu'un `type="module"` est différé par construction : la fusion a donc
		 * eu lieu avant que l'éditeur ne lise son contexte.
		 */
		wp_register_script( self::HANDLE, false, array( 'teeshoop-editeur' ), null, true );
		wp_enqueue_script( self::HANDLE );
		wp_add_inline_script( self::HANDLE, self::inline_merge( self::extras( (int) get_queried_object_id() ) ) );
	}

	/**
	 * Ce que l'atelier ajoute au contexte de la fiche produit.
	 *
	 * @return array<string,mixed>
	 */
	private static function extras( int $product_id ): array {
		/*
		 * `woocommerce_single` et non `woocommerce_thumbnail` : cette clé sert à
		 * la mise en page pleine page, où la photographie est montrée plus
		 * grande que dans un nuancier. Absente est un état valide et il vaut '' :
		 * `false` traverserait `wp_json_encode` en `false` et l'éditeur devrait
		 * distinguer deux formes de vide.
		 */
		$image = get_the_post_thumbnail_url( $product_id, 'woocommerce_single' );

		return self::extra_context(
			(string) get_permalink( $product_id ),
			is_string( $image ) ? $image : ''
		);
	}

	/**
	 * Les trois clés, et rien d'autre. PURE.
	 *
	 * IL N'Y A PAS DE PRIX ICI NON PLUS, et le test le vérifie par le nom des
	 * clés : la fiche produit et l'atelier remettent le même contrat à
	 * l'éditeur, qui demande chaque montant au serveur.
	 *
	 * @return array<string,mixed>
	 */
	public static function extra_context( string $product_url, string $image_url ): array {
		return array(
			// L'éditeur lit ce drapeau pour basculer sur la mise en page pleine
			// page. Un booléen, pas « 1 » : voir `assets()`.
			'atelier'      => true,
			'productUrl'   => $product_url,
			'productImage' => $image_url,
		);
	}

	/**
	 * La fusion, en JavaScript. PURE.
	 *
	 * `Object.assign` sur l'objet existant plutôt qu'une réaffectation : ce
	 * script tourne APRÈS la déclaration de `wp_localize_script`, et écraser
	 * l'objet ferait disparaître le vêtement, le nuancier, les tailles et le
	 * nonce.
	 *
	 * `wp_json_encode` échappe `/` par défaut, donc une valeur contenant
	 * `</script>` ressort `<\/script>` et ne peut pas fermer la balise. C'est la
	 * raison pour laquelle les options d'encodage ne sont pas touchées.
	 *
	 * @param array<string,mixed> $extras
	 */
	public static function inline_merge( array $extras ): string {
		return 'window.TEESHOOP_EDITEUR = Object.assign( window.TEESHOOP_EDITEUR || {}, '
			. (string) wp_json_encode( $extras ) . ' );';
	}

	// -----------------------------------------------------------------------
	// Ce que cette page dit à un moteur de recherche
	// -----------------------------------------------------------------------

	/**
	 * `noindex, follow`.
	 *
	 * ── POURQUOI `noindex` ───────────────────────────────────────────────────
	 *
	 * Une session de personnalisation n'est pas un document. Elle n'a pas de
	 * contenu propre : c'est un outil monté au-dessus d'un produit dont la
	 * fiche, elle, est la page que la boutique veut voir classée. Indexée,
	 * cette adresse ferait concurrence à la fiche sur les mêmes mots, et un
	 * client arrivant d'un moteur atterrirait dans un canevas vide au lieu de
	 * la description, du tableau des tailles et de la grille de tarifs.
	 *
	 * `follow`, parce que le lien de retour vers la fiche est un vrai lien et
	 * qu'il n'y a aucune raison de couper le chemin qui y mène.
	 *
	 * ── ET POURQUOI IL N'Y A PAS DE `rel=canonical` VERS LA FICHE ────────────
	 *
	 * Le brief de cette page en demandait un. Il n'y en a pas, délibérément, et
	 * voici les deux raisons, dans l'ordre de gravité.
	 *
	 * D'ABORD, `includes/Seo.php` interdit exactement ce couple, avec la raison
	 * écrite en tête de fichier : « une page `noindex` ne doit PAS porter un
	 * `rel=canonical` qui pointe ailleurs », parce que les deux instructions se
	 * contredisent et que la documentation de Google avertit que le `noindex`
	 * peut VOYAGER le long du canonique jusqu'à sa cible. Le cas y est décrit à
	 * l'identique : des pages `noindex` pointant vers les pages que la boutique
	 * veut classer. Ici la cible serait la fiche produit, c'est-à-dire la page
	 * la plus précieuse du site. Ce serait reproduire, sur les 2 309 fiches, le
	 * défaut qu'un fichier entier a été écrit pour empêcher.
	 *
	 * ENSUITE, `Seo::head()` est le SEUL endroit du greffon qui imprime un
	 * canonique, et il refuse de le faire quand `wp_robots` a répondu
	 * `noindex`. Un canonique imprimé ici serait donc une seconde autorité sur
	 * la même balise, dans un fichier que rien ne relie à celui qui décide.
	 *
	 * Ce que le brief voulait obtenir (« ce n'est pas un document qu'un moteur
	 * doit garder ») est obtenu par le `noindex` seul, qui est la directive
	 * fiable des deux : un canonique n'est qu'une indication.
	 *
	 * @param array<string,mixed> $robots
	 * @return array<string,mixed>
	 */
	public static function robots( $robots ): array {
		if ( ! is_array( $robots ) ) {
			return array();
		}
		if ( ! self::is_request() ) {
			return $robots;
		}
		$robots['noindex'] = true;
		$robots['follow']  = true;
		return $robots;
	}

	// -----------------------------------------------------------------------
	// La coquille
	// -----------------------------------------------------------------------

	/**
	 * La feuille de la coquille, en ligne, sous `.ts-atelier` et nulle part ailleurs.
	 *
	 * ── EN LIGNE, PARCE QUE C'EST UNE PAGE ET PAS UNE FEUILLE ────────────────
	 *
	 * Une trentaine de règles pour une seule adresse. Un fichier de plus, c'est
	 * une requête de plus sur un téléphone pour moins de deux kilooctets, et un
	 * fichier que `scripts/php-guard.mjs` scanne mais que rien ne relie à sa
	 * page. `BatPage.php` a tranché pareil, pour la même raison.
	 *
	 * ── AUCUN SÉLECTEUR D'ÉLÉMENT NU ─────────────────────────────────────────
	 *
	 * C'est la réponse 1 de `src/native/main.ts`, et elle vaut ici : cette
	 * feuille est chargée sur une boutique dont nous ne possédons pas le thème.
	 * Tout est sous `.ts-atelier`.
	 *
	 * ── AUCUNE HAUTEUR IMPOSÉE AU CANEVAS ────────────────────────────────────
	 *
	 * `100dvh` sur le conteneur du canevas est la raison 2 du document de
	 * décision, celle qui tuait le défilement du site. Le paquet natif suit son
	 * conteneur par `ResizeObserver` : lui donner une hauteur ici serait un
	 * second avis sur une dimension qu'il mesure déjà, et le jour où les deux
	 * divergent c'est le canevas qui est coupé.
	 */
	private static function css(): string {
		return <<<'CSS'
.ts-atelier{max-width:var(--ts-page);margin:0 auto;padding:var(--ts-space-3) var(--ts-space-3) var(--ts-space-6);font-family:var(--ts-font);color:var(--ts-ink)}
.ts-atelier__bar{display:flex;flex-direction:column;gap:var(--ts-space-2);padding-bottom:var(--ts-space-3);border-bottom:1px solid var(--ts-line)}
.ts-atelier__retour{align-self:flex-start;font-size:var(--ts-text-sm);color:var(--ts-accent);text-decoration:underline}
.ts-atelier__titre{margin:0;font-family:var(--ts-font-display);font-weight:700;font-size:var(--ts-display-xs);line-height:var(--ts-leading-tight)}
.ts-atelier__evitement{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.ts-atelier__evitement:focus{position:static;width:auto;height:auto;margin:0;padding:var(--ts-space-2) var(--ts-space-3);overflow:visible;clip-path:none;background:var(--ts-accent);color:var(--ts-accent-ink);text-decoration:none}
.ts-atelier__scene{margin-top:var(--ts-space-4)}
.ts-atelier__refus{margin-top:var(--ts-space-4);padding:var(--ts-space-4);background:var(--ts-paper);border:1px solid var(--ts-line)}
.ts-atelier__refus p{margin:0 0 var(--ts-space-3);max-width:var(--ts-measure)}
.ts-atelier__refus p:last-child{margin-bottom:0}
.ts-atelier__actions{display:flex;flex-direction:column;gap:var(--ts-space-2);margin-top:var(--ts-space-4)}
.ts-atelier__devis{margin-top:var(--ts-space-6);padding-top:var(--ts-space-4);border-top:1px solid var(--ts-line)}
.ts-atelier__devis h2{margin:0 0 var(--ts-space-2);font-family:var(--ts-font-display);font-weight:600;font-size:var(--ts-text-lg)}
.ts-atelier__devis p{margin:0 0 var(--ts-space-3);max-width:var(--ts-measure);color:var(--ts-muted-strong)}
.ts-atelier__note{margin-top:var(--ts-space-4);padding:var(--ts-space-3);border-left:3px solid var(--ts-warn);background:var(--ts-warn-wash);color:var(--ts-warn-ink);font-size:var(--ts-text-sm)}
.ts-atelier a:focus-visible,.ts-atelier [tabindex]:focus-visible{outline:var(--ts-focus-width) solid var(--ts-accent);outline-offset:var(--ts-focus-offset)}
@media (min-width:48rem){
.ts-atelier{padding:var(--ts-space-4) var(--ts-space-5) var(--ts-space-7)}
.ts-atelier__titre{font-size:var(--ts-display-sm)}
.ts-atelier__actions{flex-direction:row}
.ts-atelier__actions .ts-cta{min-width:15rem}
}
CSS;
	}
}
