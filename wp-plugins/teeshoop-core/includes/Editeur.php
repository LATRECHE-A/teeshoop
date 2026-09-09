<?php
/**
 * Le personnalisateur, dans la fiche produit, sans cadre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER REMPLACE, ET POURQUOI CE N'EST PAS UN REVIREMENT DE GOÛT
 *
 * `Shortcode.php` encadrait une application React servie en croisé par un
 * Worker Cloudflare, et défendait ce choix avec six raisons techniques qui
 * étaient toutes vraies. Elles décrivaient une propriété de CETTE
 * application-là, pas une propriété de l'idée d'un personnalisateur intégré.
 * Les six réponses en code sont écrites dans `src/native/main.ts`, à côté de la
 * raison qu'elles ferment, et `scripts/editeur-guard.mjs` les mesure.
 *
 * Ce que l'encadrement coûtait, mesuré le 5 septembre 2026 :
 *
 *   le cadre n'ouvrait PAS sur le produit cliqué. Il restaurait le dernier
 *   brouillon du visiteur, ou chargeait `makeSampleDesign()`, un t-shirt noir
 *   portant « TSHOP » en arche. Un client qui cliquait « Personnaliser » sur un
 *   sweat voyait le vêtement de quelqu'un d'autre et l'apprenait au dernier
 *   clic ;
 *
 *   la création et les fichiers du client vivaient dans un stockage tiers
 *   partitionné, qu'un rechargement de page peut effacer ;
 *
 *   si le Worker tombait, plus aucun produit personnalisable n'était achetable
 *   et la page ne disait rien : `bridge.js` attachait un écouteur `load` et
 *   n'avait aucun chemin d'erreur.
 *
 * Le poids n'était pas l'argument : 246 473 octets compressés pour la charge
 * immédiate du studio, contre 322 662 pour Fancy Product Designer que la
 * production charge déjà sur chaque fiche. L'éditeur natif en pèse 122 763,
 * mesurés par la même méthode.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE BASCULEMENT EST UN DRAPEAU
 *
 * Une fiche produit incapable de vendre est strictement pire qu'une fiche qui
 * vend à travers un cadre. Tant que le chemin natif n'est pas vert de bout en
 * bout contre un vrai WooCommerce, l'ancien reste branché. `est_actif()` est le
 * seul endroit qui décide, et `Settings` porte l'option.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI NE CHANGE PAS, ET C'EST L'ESSENTIEL
 *
 * Le serveur calcule chaque prix payable, `Cart::add` redérive le vêtement
 * depuis `Product::garment_of` et les faces imprimées depuis le document que le
 * Worker a stocké, `Design::verify` échoue fermé, `Rest::check_nonce` exige
 * `x-wp-nonce` explicitement et `refuse_plain_add` refuse toujours tout ajout
 * qui ne passe pas par `Cart::add`. Un éditeur dans la page n'obtient pas plus
 * de confiance qu'un éditeur dans un cadre.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Editeur {

	/** La poignée des deux actifs, et le préfixe de leur URL. */
	private const HANDLE = 'teeshoop-editeur';
	private const DIR    = 'assets/editeur/';

	/**
	 * L'entrée et sa feuille, trouvées par leur EMPREINTE dans ce répertoire.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * POURQUOI PAS UN NOM STABLE PLUS `?ver=`, QUI EST L'HABITUDE WORDPRESS
	 *
	 * Parce qu'un module ES importe ses morceaux par le nom que le
	 * constructeur a écrit, SANS requête. Avec `editeur.js?ver=0.1.0` dans la
	 * balise et `./editeur.js` dans le morceau paresseux, le navigateur voit
	 * deux URL, donc deux modules : cliquer « Ouvrir les réglages avancés »
	 * réexécutait l'entrée, remontait un second éditeur par-dessus le premier et
	 * vidait son conteneur. Mesuré le 5 septembre 2026 ; la seule trace était
	 * « Several Konva instances detected » dans la console.
	 *
	 * L'empreinte dans le nom donne une URL immuable, donc une instance, et elle
	 * casse le cache mieux qu'une requête. Le répertoire est LISTÉ plutôt que lu
	 * dans un manifeste : `wrangler` a déjà servi une fois `.vite/manifest.json`
	 * à qui le demandait, ce qui est la carte de l'application offerte à un
	 * inconnu, et une liste de fichiers ne s'expose pas par URL.
	 *
	 * @param string $ext `js` ou `css`.
	 * @return string Le chemin relatif au greffon, ou '' si le paquet est absent.
	 */
	private static function fichier( string $ext ): string {
		static $cache = array();
		if ( isset( $cache[ $ext ] ) ) {
			return $cache[ $ext ];
		}
		$trouves = glob( TEESHOOP_CORE_DIR . self::DIR . 'editeur-*.' . $ext );
		/*
		 * ZÉRO OU PLUSIEURS SONT TOUS LES DEUX UNE PANNE, et la seconde est la
		 * sournoise : deux entrées dans le répertoire veulent dire qu'un
		 * déploiement a copié par-dessus l'ancien sans le vider, et servir « la
		 * première » serait servir celle que le tri alphabétique désigne, qui
		 * n'a aucune raison d'être la bonne. On ne sert rien, et le message de
		 * secours de la fiche produit prend le relais.
		 */
		$cache[ $ext ] = ( is_array( $trouves ) && 1 === count( $trouves ) )
			? self::DIR . basename( $trouves[0] )
			: '';
		return $cache[ $ext ];
	}

	/**
	 * Un seul éditeur par document, comme `Shortcode::$rendered` avant lui.
	 *
	 * Un thème WooCommerce rend la description d'un produit à plus d'un endroit
	 * selon le gabarit : le raccourci du studio ressortait TROIS fois sur
	 * Twenty Twenty-Five. Ici la conséquence n'est plus deux mégaoctets de WebGL
	 * en double, c'est que le nuancier mesuré est une valeur de document et que
	 * deux éditeurs se peindraient l'un l'autre. `src/native/main.ts` refuse le
	 * second de son côté aussi, et le marque au lieu de l'effacer.
	 */
	private static bool $rendu = false;

	/**
	 * Le paquet construit est-il réellement là.
	 *
	 * Un greffon déployé sans son répertoire `assets/editeur/` afficherait un
	 * conteneur vide et une fiche produit sans bouton d'achat. « Le fichier
	 * n'est pas là » et « le client n'a pas encore posé de visuel » sont deux
	 * états différents, et seul le premier est une panne à signaler.
	 */
	public static function paquet_present(): bool {
		return '' !== self::fichier( 'js' ) && '' !== self::fichier( 'css' );
	}

	// -----------------------------------------------------------------------
	// Le rendu
	// -----------------------------------------------------------------------

	/**
	 * Le conteneur, avec la phrase que lit un visiteur si rien ne démarre.
	 *
	 * LE MESSAGE DE SECOURS EST ÉCRIT PAR PHP ET LE SCRIPT NE L'EFFACE QUE
	 * QUAND IL A RÉUSSI. `bridge.js` attachait un écouteur `load` et n'avait
	 * aucun chemin d'erreur : Worker en panne, cadre vide, page muette, et
	 * aucun produit personnalisable achetable. Ici l'ordre est inversé : la
	 * page dit d'abord ce qu'il faut faire, et le script remplace ce texte
	 * seulement s'il est en état de vendre.
	 */
	public static function rendre(): void {
		if ( self::$rendu ) {
			return;
		}
		self::$rendu = true;

		$product_id = (int) get_queried_object_id();
		$garment    = Product::garment_of( $product_id );

		if ( '' === $garment ) {
			// L'article ne déclare aucun vêtement : `Cart::add` refuserait de
			// toute façon. Personne ne voit un éditeur qui ne peut pas vendre.
			if ( current_user_can( 'manage_options' ) ) {
				printf(
					'<p class="teeshoop-error">%s</p>',
					esc_html__( 'Teeshoop : cet article ne déclare aucun vêtement, l’éditeur ne peut donc pas l’ajouter au panier. Renseignez « Vêtement Teeshoop » sur la fiche produit.', 'teeshoop' )
				);
			}
			return;
		}

		if ( ! self::paquet_present() ) {
			if ( current_user_can( 'manage_options' ) ) {
				printf(
					'<p class="teeshoop-error">%s</p>',
					esc_html__( 'Teeshoop : le paquet de l’éditeur est absent du greffon, ou le répertoire assets/editeur/ en porte deux. Lancez « npm run build:editeur », puis redéployez le répertoire entier.', 'teeshoop' )
				);
			}
			// Et le visiteur garde le message de secours ci-dessous, qui le
			// mène au devis plutôt qu'à une page morte.
		}

		printf(
			'<div class="teeshoop-editeur" data-teeshoop-editeur data-teeshoop-produit="%d"><p class="teeshoop-editeur__secours">%s <a href="%s">%s</a></p></div>',
			(int) $product_id,
			esc_html__( 'Le personnalisateur n’a pas démarré sur cette page. Rechargez-la ; si cela se reproduit, demandez-nous un devis et joignez votre visuel, nous prenons la commande à la main.', 'teeshoop' ),
			esc_url( '#teeshoop-devis' ),
			esc_html__( 'Demander un devis', 'teeshoop' )
		);
	}

	// -----------------------------------------------------------------------
	// Les actifs et le contexte
	// -----------------------------------------------------------------------

	public static function enqueue(): void {
		if ( ! self::paquet_present() ) {
			return;
		}

		$product_id = (int) get_queried_object_id();
		$garment    = Product::garment_of( $product_id );
		if ( '' === $garment ) {
			return;
		}

		/*
		 * ─────────────────────────────────────────────────────────────────────
		 * UN ARTICLE PROTÉGÉ PAR MOT DE PASSE NE PUBLIE PAS SON CONTEXTE.
		 *
		 * `Editeur::rendre()` ne pose pas le conteneur quand WordPress affiche
		 * le formulaire de mot de passe, mais `enqueue()` continuait de publier
		 * `TEESHOOP_EDITEUR` : le nonce REST, les noms de coloris du fabricant,
		 * la charte des tailles en centimètres et les zones d'impression. Mesuré
		 * dans un navigateur le 9 septembre 2026, mot de passe posé : le
		 * formulaire s'affichait et l'objet était dans la page, complet.
		 *
		 * Un mot de passe est la façon dont une boutique prépare un article pour
		 * un client ou un revendeur avant de l'ouvrir. Ce qu'il protège n'est pas
		 * seulement le bouton d'achat, c'est la fiche : les coloris qu'on
		 * proposera et les cotes qu'on imprimera en font partie.
		 */
		if ( post_password_required( $product_id ) ) {
			return;
		}

		/*
		 * `null` EN VERSION, ET C'EST LE POINT DE TOUT CE QUI PRÉCÈDE.
		 *
		 * WordPress ajoute `?ver=…` quand on lui donne une version, et cette
		 * requête est exactement ce qui dédoublait le module. L'empreinte est
		 * dans le nom : l'URL change quand le contenu change, et pas autrement.
		 */
		wp_enqueue_style( self::HANDLE, TEESHOOP_CORE_URL . self::fichier( 'css' ), array( 'teeshoop-tokens' ), null );

		wp_enqueue_script( self::HANDLE, TEESHOOP_CORE_URL . self::fichier( 'js' ), array(), null, true );

		/*
		 * `type="module"`, ET C'EST CE QUI PAIE LA VUE AVANCÉE.
		 *
		 * Sans module, pas d'`import()`, donc pas de morceau paresseux, donc les
		 * treize familles de polices d'impression et leurs 1,5 Mo de fontes
		 * descendraient chez un client qui n'écrit pas de texte. WordPress
		 * n'expose pas d'option pour ça sur `wp_enqueue_script` ; le filtre est
		 * la façon documentée de le faire, restreint à notre seule poignée.
		 *
		 * `wp_enqueue_script_module()` existe depuis WordPress 6.5 et ferait la
		 * même chose plus proprement, sauf qu'il ne connaît pas
		 * `wp_localize_script` : il faudrait un second script en ligne pour
		 * poser le contexte, donc deux balises au lieu d'une et un ordre à
		 * garantir. Le filtre coûte six lignes et rien d'autre.
		 */
		add_filter( 'script_loader_tag', array( self::class, 'balise_module' ), 10, 3 );

		/*
		 * TOUT DEVIENT UNE CHAÎNE DE CARACTÈRES EN TRAVERSANT.
		 *
		 * `wp_localize_script` sérialise le tableau et les entiers ressortent
		 * entre guillemets. `src/native/contexte.ts` est le seul lecteur et il
		 * reconvertit tout ; rien d'autre dans le paquet ne relit cet objet.
		 */
		wp_localize_script( self::HANDLE, 'TEESHOOP_EDITEUR', self::contexte( $product_id, $garment ) );
	}

	/** @param string $tag @param string $handle @param string $src */
	public static function balise_module( $tag, $handle, $src ): string {
		if ( self::HANDLE !== $handle ) {
			return (string) $tag;
		}
		return sprintf(
			'<script type="module" src="%s" id="%s-js"></script>' . "\n",
			esc_url( (string) $src ),
			esc_attr( (string) $handle )
		);
	}

	/**
	 * Ce que la fiche produit remet à l'éditeur.
	 *
	 * IL N'Y A PAS UN PRIX ICI. Le serveur calcule chaque prix payable et
	 * l'éditeur le demande par `GET /wp-json/teeshoop/v1/quote`. Ce qui est
	 * publié, ce sont les deux SEUILS au-delà desquels la boutique cesse de
	 * chiffrer, parce que l'écran doit pouvoir le dire avant que le panier le
	 * refuse, et un seuil n'est pas un tarif.
	 *
	 * @return array<string,mixed>
	 */
	private static function contexte( int $product_id, string $garment ): array {
		$config = Settings::pricing();

		return array(
			'productId'     => $product_id,
			'garment'       => $garment,
			'title'         => get_the_title( $product_id ),
			// Construit avec `URL()` de l'autre côté, jamais par concaténation
			// d'un « ? » : en permaliens simples `restUrl` en porte déjà un, et
			// un second transforme chaque devis en 404. Mesuré le 14/08/2026.
			'restUrl'       => esc_url_raw( rest_url( 'teeshoop/v1/' ) ),
			/*
			 * LE NONCE RESTE SUR CETTE PAGE, ET IL NE TRAVERSE PLUS RIEN.
			 *
			 * C'était la raison d'être de `bridge.js` : le studio vivait sur une
			 * autre origine, n'avait pas le cookie, et devait demander à la page
			 * parente d'agir. L'éditeur est dans la page, donc il le tient
			 * lui-même. Ce qui ne change pas : `Rest::check_nonce` l'exige
			 * explicitement, parce que WordPress ne rejette qu'un MAUVAIS nonce
			 * de cookie et jamais un nonce absent.
			 */
			'nonce'         => wp_create_nonce( 'wp_rest' ),
			'cartUrl'       => function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : home_url( '/' ),
			/*
			 * OÙ DÉPOSER LA CRÉATION. Le Worker, en croisé, ce qui est le seul
			 * appel inter-origines qui reste et la raison du CORS ajouté à
			 * `worker/cors.ts` la même nuit. Vide, l'éditeur refuse l'ajout au
			 * panier avec une phrase française plutôt que de laisser un client
			 * travailler pour rien : « nous n'avons pas pu demander » n'est pas
			 * « oui », et `Design::verify` refuserait de toute façon.
			 */
			'workerUrl'     => self::origine_worker(),
			'colours'       => self::couleurs( $product_id ),
			/*
			 * LES TAILLES QUE LE PANIER ACCEPTERA, PAS CELLES DE LA FAMILLE.
			 *
			 * `Design::unprintable_sizes` refuse toute taille absente de la
			 * fiche du fabricant dès que cette fiche existe. L'éditeur offrait
			 * les six tailles de `garments.json` : sur une référence dont la
			 * fiche n'en porte que quatre, un client remplissait une case 3XL,
			 * attendait la mesure de l'encre et le téléversement de son fichier,
			 * et se faisait refuser par une phrase qui parlait du marquage trop
			 * grand alors que la vraie raison est qu'on n'a pas la demi-poitrine
			 * de cette taille. Trouvé par la passe adversariale du 5 septembre.
			 *
			 * L'INTERSECTION et pas la fiche seule : les fiches fournisseur
			 * portent des XS, 4XL et 5XL que `Garments` ne connaît pas et que
			 * `Design::unprintable_sizes` refuse aussi.
			 */
			'sizes'         => self::tailles_vendables( $product_id, $garment ),
			'pricedSize'    => Garments::priced_size( $garment ),
			'sizeChart'     => ProductPage::maker_chart( $product_id ),
			'areas'         => self::zones( $garment ),
			'sides'         => self::faces( $garment ),
			/*
			 * LA BASE FISCALE DE CETTE BOUTIQUE, ET PAS UNE QUATRIÈME COPIE DE
			 * LA RÈGLE.
			 *
			 * `Settings::price_bases()` existe pour empêcher exactement ce que
			 * l'éditeur faisait : imprimer un total TTC, le mot « TTC » et
			 * « TVA X % incluse » sans regarder si cette boutique a une TVA. La
			 * fiche produit et la grille de tarifs le lisent déjà ; l'éditeur
			 * était la troisième surface de prix de la même page et la seule à
			 * ne pas le faire.
			 *
			 * Deux états que rien ne distinguait, trouvés par la passe
			 * adversariale du 5 septembre 2026. Sous la franchise en base
			 * (article 293 B du CGI) le taux vaut 0, et l'éditeur écrivait
			 * « TVA 0 % incluse » là où la mention obligatoire est une autre
			 * phrase, à dix centimètres d'une grille qui disait « TVA non
			 * applicable ». Régime INCONNU, il écrivait « TVA 20 % incluse » sur
			 * une boutique que `Vat::problems()` déclare incapable de facturer.
			 * `known` sépare les deux, `mention` porte la phrase du régime.
			 */
			'priceBases'    => Settings::price_bases(),
			'maxQty'        => (int) $config['max_qty'],
			'quoteFromQty'  => (int) $config['quote_from_qty'],
			'quoteFromHt'   => (int) $config['quote_from_ht'],
			'quoteUrl'      => '#teeshoop-devis',
		);
	}

	/**
	 * Les tailles que l'éditeur a le droit d'offrir.
	 *
	 * L'intersection de la charte de la famille et de la fiche du fabricant,
	 * dans l'ordre de la charte. Une fiche vide veut dire « on ne l'a pas lue »
	 * et pas « aucune taille » : `Design::unprintable_sizes` ne refuse alors
	 * rien sur ce motif, donc l'éditeur n'a rien à retirer non plus.
	 *
	 * @return string[]
	 */
	private static function tailles_vendables( int $product_id, string $garment ): array {
		$famille = ProductPage::size_ids( $garment );
		$fiche   = ProductPage::maker_chart( $product_id );
		if ( array() === $fiche ) {
			return $famille;
		}
		return array_values( array_filter( $famille, static fn( string $t ): bool => isset( $fiche[ $t ] ) ) );
	}

	/**
	 * L'origine du Worker, sans le chemin.
	 *
	 * `worker_url` porte une URL complète parce que `Design::verify` y colle
	 * `/api/design/`. L'éditeur, lui, a besoin de la base : il compose
	 * `POST {base}/api/design`. `Url::origin_of` est la SEULE normalisation
	 * d'origine du greffon depuis le 5 septembre 2026 : `Csp` en avait une
	 * copie sans liste blanche de schémas, et deux normalisations différentes
	 * pour une même valeur, c'est `connect-src` qui refuse un dépôt qu'il croit
	 * autoriser.
	 */
	private static function origine_worker(): string {
		return Url::origin_of( (string) Settings::get( 'worker_url' ) );
	}

	/**
	 * Les coloris achetables, avec leur pastille mesurée et la photographie.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * IL N'Y A QU'UNE PHOTOGRAPHIE PAR RÉFÉRENCE, ET C'EST UNE MESURE.
	 *
	 * Relevé le 5 septembre 2026 sur le Gildan Heavy Cotton du miroir : le
	 * produit fournisseur porte 366 déclinaisons et 54 coloris, et UNE seule
	 * photographie distincte pour les 54. Le fournisseur n'a pas livré de vue
	 * par coloris, ou l'import ne l'a pas reprise.
	 *
	 * Donc la même image accompagne chaque coloris, et l'écran dit ce qu'elle
	 * est. Inventer une teinte sur la photographie, ou laisser croire qu'elle
	 * montre la couleur choisie, serait du contenu fabriqué : `CLAUDE.md`
	 * section 7 demande l'état vide, pas la fiction plausible. La couleur, elle,
	 * est vraie : la pastille est la mesure prise sur la puce du fabricant, et
	 * le gabarit est peint avec.
	 *
	 * @return array<int,array<string,string|string[]>>
	 */
	private static function couleurs( int $product_id ): array {
		$photo = (string) get_the_post_thumbnail_url( $product_id, 'woocommerce_thumbnail' );
		$out   = array();
		foreach ( Product::blank_palette_of( $product_id ) as $entree ) {
			$entree['photo'] = $photo;
			$out[]           = $entree;
		}
		return $out;
	}

	/**
	 * La zone imprimable par face et par taille, centimètres.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * ELLE EST DÉRIVÉE, PAS MESURÉE SUR LA PHOTOGRAPHIE, ET C'EST UN CONSTAT.
	 *
	 * `Garments::area_by_size()` lit `data/garments.json`, qui est la MÊME
	 * source que `Design::unprintable_sizes` consulte pour refuser une ligne
	 * qu'un film de 33 cm ne peut pas porter. Une seconde implémentation de
	 * « quelle est la zone » diverge le jour où quelqu'un modifie l'une des
	 * deux, et ce jour-là le client voit un rectangle et l'atelier en presse un
	 * autre.
	 *
	 * `_teeshoop_zone_impression`, la zone mesurée sur la photographie du
	 * fournisseur, n'existe sur aucun produit : la nuit 2 a construit la
	 * machinerie, l'a lancée sur les dix-huit photographies de la gamme et les a
	 * refusées une par une (sept torses occupant 85 à 99 % de la silhouette,
	 * sept encolures introuvables, quatre détourages qui ne rendent pas une
	 * forme de vêtement), parce que les vues de face du fournisseur sont des
	 * mannequins vivants. Relevé sur le miroir le 5 septembre : zéro
	 * `_teeshoop_zone_impression`, neuf `_teeshoop_zone_refus`.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	private static function zones( string $garment ): array {
		$out = array();
		foreach ( self::faces( $garment ) as $side ) {
			$par_taille = Garments::area_by_size( $garment, $side );
			if ( ! empty( $par_taille ) ) {
				$out[] = array(
					'side'   => $side,
					'bySize' => $par_taille,
				);
			}
		}
		return $out;
	}

	/**
	 * Les faces que ce vêtement peut vraiment porter.
	 *
	 * Prises de `data/garments.json` et non de la liste des trois faces que le
	 * dessin connaît : une référence sans manche imprimable proposerait sinon
	 * une face que le bon de commande fournisseur refuserait, après le paiement.
	 *
	 * @return string[]
	 */
	private static function faces( string $garment ): array {
		$declarees = Garments::get( $garment )['printableSides'] ?? array();
		$out       = array();
		foreach ( (array) $declarees as $side ) {
			$id = sanitize_key( (string) $side );
			if ( '' !== $id ) {
				$out[] = $id;
			}
		}
		return $out;
	}
}
