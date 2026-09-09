<?php
/**
 * L'atelier : les parties qui ne demandent rien à WordPress.
 *
 * CE QUI EST TESTÉ ICI est ce qui décide de l'ADRESSE et du CONTRAT :
 * la règle de réécriture, la réinterprétation du repli laid, la fabrication
 * d'un chemin depuis un identifiant d'URL, les trois clés ajoutées au contexte
 * de l'éditeur, et le script qui les y fusionne.
 *
 * CE QUI N'EST PAS TESTÉ ICI, ET POURQUOI : `etat()`, `serve()` et `assets()`
 * lisent des métadonnées de produit, la file d'actifs et le paquet construit.
 * Les rejouer avec des doublures prouverait que la doublure est d'accord avec
 * elle-même. Ils appartiennent au harnais qui ouvre une vraie fiche produit
 * dans un vrai WooCommerce (`npm run test:wp`, `scripts/wp-e2e-verify.mjs`).
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

/*
 * COMMAND LINE ONLY. `wp-content/plugins/` is served by URL and this directory
 * is inside it: before the guards, GET on any of these files ran the suite to
 * the public internet and printed the figures of every failing assertion.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

/*
 * La SEULE fonction WordPress que la partie pure appelle. `wp_json_encode` est
 * `json_encode` plus une profondeur bornée et un repli quand la chaîne n'est
 * pas de l'UTF-8 valide ; pour ce que le fichier encode (deux URL et un
 * booléen) les deux répondent la même chose. Le repli est déjà utilisé par
 * `tests/test-privacy.php` pour la même raison.
 */
if ( ! function_exists( 'wp_json_encode' ) ) {
	function wp_json_encode( $data, $options = 0, $depth = 512 ) {
		return json_encode( $data, (int) $options, (int) $depth );
	}
}

require_once __DIR__ . '/../includes/Atelier.php';

use Teeshoop\Core\Atelier;

describe( 'Atelier: l’adresse', function () {

	it( 'attrape /personnaliser/{identifiant}/ avec ou sans barre finale', function () {
		$re = '#' . Atelier::rewrite_regex() . '#';

		truthy( 1 === preg_match( $re, 'personnaliser/tee-shirt-coton-bio/', $m ), 'avec barre finale' );
		eq( $m[1], 'tee-shirt-coton-bio', 'identifiant capturé' );

		truthy( 1 === preg_match( $re, 'personnaliser/tee-shirt-coton-bio', $m2 ), 'sans barre finale' );
		eq( $m2[1], 'tee-shirt-coton-bio', 'identifiant capturé' );
	} );

	it( 'n’attrape ni la base seule ni un chemin plus profond', function () {
		$re = '#' . Atelier::rewrite_regex() . '#';

		// `personnaliser/` seul n'a pas de produit : sans ce refus la règle
		// enverrait une requête produit sans identifiant, donc la boutique
		// entière, avec le drapeau de l'atelier posé dessus.
		eq( preg_match( $re, 'personnaliser/' ), 0, 'la base seule' );
		eq( preg_match( $re, 'personnaliser' ), 0, 'la base sans barre' );
		eq( preg_match( $re, 'personnaliser/a/b/' ), 0, 'deux segments' );
	} );

	it( 'vise une VRAIE requête de produit, pas une page inventée', function () {
		$cible = Atelier::rewrite_target();

		// C'est ce qui donne le 404 de WordPress sur un identifiant inconnu,
		// `get_queried_object_id()` sur le bon article, et donc `Editeur::enqueue()`
		// qui fonctionne sans savoir sur quelle adresse il est.
		truthy( str_contains( $cible, 'post_type=product' ), 'post_type=product' );
		truthy( str_contains( $cible, 'product=$matches[1]' ), 'l’identifiant capturé' );
		truthy( str_contains( $cible, Atelier::QUERY_VAR . '=1' ), 'le drapeau' );
	} );

	it( 'fabrique un chemin depuis un identifiant d’URL, accents compris', function () {
		eq( Atelier::path_for( 'tee-shirt-coton-bio' ), 'personnaliser/tee-shirt-coton-bio/' );
		// `sanitize_title()` encode les accents en %xx : « t-shirt-été ».
		eq( Atelier::path_for( 't-shirt-%c3%a9t%c3%a9' ), 'personnaliser/t-shirt-%c3%a9t%c3%a9/' );
		eq( Atelier::path_for( 'sweat_capuche.v2' ), 'personnaliser/sweat_capuche.v2/' );
	} );

	it( 'refuse un identifiant qui n’en est pas un, plutôt que de le réparer', function () {
		/*
		 * Une valeur qu'on ne sait pas lire doit refuser, pas produire quelque
		 * chose de plausible : `Url::origin_of` tient la même ligne. Une barre
		 * oblique qui passe fabriquerait une adresse qui mène ailleurs que là
		 * où l'appelant croit.
		 */
		eq( Atelier::path_for( '' ), '', 'vide' );
		eq( Atelier::path_for( 'a/b' ), '', 'une barre oblique' );
		eq( Atelier::path_for( '../wp-admin' ), '', 'une remontée de chemin' );
		eq( Atelier::path_for( 'mon tee' ), '', 'une espace' );
		eq( Atelier::path_for( 'tee?x=1' ), '', 'une requête' );
		eq( Atelier::path_for( 'tee#ancre' ), '', 'une ancre' );
		eq( Atelier::path_for( "tee\n" ), '', 'un retour à la ligne' );
	} );
} );

describe( 'Atelier: le repli laid ?teeshoop_atelier={id}', function () {

	it( 'ne touche à rien quand la variable est absente', function () {
		$vars = array( 'pagename' => 'cgv' );
		eq( Atelier::resolve( $vars ), $vars );
	} );

	it( 'transforme un identifiant en requête de produit', function () {
		$out = Atelier::resolve( array( Atelier::QUERY_VAR => '4207' ) );
		eq( $out['p'], 4207, 'l’article' );
		eq( $out['post_type'], 'product', 'et seulement un produit' );
	} );

	it( 'force post_type=product, donc l’atelier n’ouvre rien d’autre', function () {
		/*
		 * Sans ce forçage, `?teeshoop_atelier=12` serait une visionneuse par
		 * numéro : une page, un article, un brouillon, une commande. Avec lui,
		 * un identifiant qui n'est pas un produit publié ne correspond à rien
		 * et WordPress rend 404.
		 */
		$out = Atelier::resolve( array( Atelier::QUERY_VAR => '12' ) );
		eq( $out['post_type'], 'product' );
	} );

	it( 'ne réinterprète jamais ce que la jolie adresse a déjà résolu', function () {
		// La règle de réécriture pose `product` ET le drapeau. Si `resolve()`
		// écrivait `p` par-dessus, la jolie adresse ouvrirait l'article
		// numéro 1 de la boutique au lieu de celui qui a été cliqué.
		$vars = array(
			'post_type'         => 'product',
			'product'           => 'tee-shirt-coton-bio',
			Atelier::QUERY_VAR  => '1',
		);
		$out = Atelier::resolve( $vars );
		truthy( ! isset( $out['p'] ), 'aucun p ajouté' );
		eq( $out['product'], 'tee-shirt-coton-bio', 'l’identifiant est intact' );

		foreach ( array( 'name', 'p', 'page_id', 'pagename' ) as $deja ) {
			$out = Atelier::resolve( array( $deja => 'x', Atelier::QUERY_VAR => '99' ) );
			truthy( ! isset( $out['post_type'] ), "rien n’est réécrit quand {$deja} est posé" );
		}
	} );

	it( 'ne fabrique pas de requête depuis une valeur illisible', function () {
		/*
		 * `3.9e2` et ` 12` sont les deux qui ont motivé `ctype_digit` : sous
		 * PHP 8 un `(int)` seul en tire 390 et 12, donc une adresse écrite à la
		 * main ouvrirait un autre article que celui qu'elle nomme.
		 */
		foreach ( array( '0', '-4', 'abc', '', '3.9e2', ' 12', '+12', '12abc', '0x10' ) as $valeur ) {
			$out = Atelier::resolve( array( Atelier::QUERY_VAR => $valeur ) );
			truthy(
				! isset( $out['post_type'] ),
				'aucune requête produit pour ' . var_export( $valeur, true )
			);
		}
	} );

	it( 'survit à une valeur qui n’est pas un scalaire', function () {
		// `$_GET[…]` peut être un tableau, et `(int) array()` est une erreur
		// fatale sous PHP 8. Une page publique ne tombe pas parce qu'un
		// paramètre a été écrit à la main.
		$out = Atelier::resolve( array( Atelier::QUERY_VAR => array( 'x' ) ) );
		truthy( ! isset( $out['p'] ), 'rien n’est déduit d’un tableau' );

		eq( Atelier::resolve( 'pas un tableau' ), array(), 'et pas d’un non-tableau' );
	} );
} );

describe( 'Atelier: les trois clés remises à l’éditeur', function () {

	it( 'publie exactement atelier, productUrl et productImage', function () {
		$extras = Atelier::extra_context( 'https://x.fr/produit/tee/', 'https://x.fr/img.jpg' );
		eq( array_keys( $extras ), array( 'atelier', 'productUrl', 'productImage' ) );
	} );

	it( 'garde un vrai booléen, ce qui est la raison du script en ligne', function () {
		// `wp_localize_script` sérialise tout en chaîne : `true` en ressortirait
		// « 1 », et `src/native/contexte.ts` existe entièrement pour réparer ça.
		// La fusion passe par `wp_json_encode`, donc le type survit.
		$extras = Atelier::extra_context( 'https://x.fr/p/', '' );
		eq( $extras['atelier'], true );
		truthy( str_contains( Atelier::inline_merge( $extras ), '"atelier":true' ), 'booléen dans le JSON' );
	} );

	it( 'laisse une photographie absente valoir la chaîne vide', function () {
		// '' veut dire « la boutique n'en a pas ». `false` ou `null` seraient
		// une deuxième forme de vide que l'éditeur devrait distinguer.
		$extras = Atelier::extra_context( 'https://x.fr/p/', '' );
		eq( $extras['productImage'], '' );
	} );

	it( 'ne remet AUCUN prix à l’éditeur', function () {
		/*
		 * `Pricing.php` est l'autorité et l'éditeur demande
		 * `GET /wp-json/teeshoop/v1/quote`. Une clé de montant ajoutée ici
		 * serait un second moteur de prix atteignable par un client, ce que le
		 * document de décision du 5 septembre compte comme revenu de 2 à 1.
		 */
		$extras = Atelier::extra_context( 'https://x.fr/p/', '' );
		foreach ( array_keys( $extras ) as $cle ) {
			foreach ( array( 'price', 'prix', 'tarif', 'total', 'ht', 'ttc', 'cost', 'cout' ) as $interdit ) {
				truthy(
					false === stripos( $cle, $interdit ),
					"la clé {$cle} ressemble à un montant"
				);
			}
		}
	} );
} );

describe( 'Atelier: la fusion dans le contexte', function () {

	it( 'fusionne au lieu de remplacer', function () {
		/*
		 * Ce script tourne APRÈS la déclaration de `wp_localize_script`. Une
		 * réaffectation (`window.TEESHOOP_EDITEUR = { … }`) effacerait le
		 * vêtement, le nuancier, les tailles et le nonce, et l'éditeur
		 * refuserait l'ajout au panier sans savoir pourquoi.
		 */
		$js = Atelier::inline_merge( Atelier::extra_context( 'https://x.fr/p/', '' ) );
		truthy( str_contains( $js, 'Object.assign' ), 'Object.assign' );
		truthy( str_contains( $js, 'window.TEESHOOP_EDITEUR || {}' ), 'l’objet existant est la base' );
	} );

	it( 'écrit sous le nom que l’éditeur lit', function () {
		// Le même global que `Editeur::contexte()` publie, pour qu'une seule
		// entrée d'éditeur serve les deux montages.
		$js = Atelier::inline_merge( Atelier::extra_context( 'https://x.fr/p/', '' ) );
		truthy( str_contains( $js, 'window.TEESHOOP_EDITEUR = ' ), 'TEESHOOP_EDITEUR' );
	} );

	it( 'ne peut pas fermer sa propre balise script', function () {
		/*
		 * Le contenu vient de `get_permalink()` et de la médiathèque, donc pas
		 * d'un visiteur ; ce test tient quand même parce que la propriété qui
		 * protège est une option d'encodage par défaut, et qu'une option par
		 * défaut se change sans y penser. `wp_json_encode` échappe `/`, donc
		 * `</script>` ressort `<\/script>`.
		 */
		$js = Atelier::inline_merge(
			Atelier::extra_context( 'https://x.fr/</script><script>alert(1)</script>', '' )
		);
		truthy( false === stripos( $js, '</script' ), 'aucune fermeture de balise' );
	} );
} );
