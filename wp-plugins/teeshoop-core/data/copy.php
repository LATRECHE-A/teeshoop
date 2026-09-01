<?php
/**
 * The shop's editorial copy: category text, sector landing pages and guides.
 *
 * Read by includes/Content.php, which resolves every `{SLOT}` in it against the
 * price authority, the workshop calendar and the studio's own print geometry,
 * and DROPS any sentence whose figure it cannot resolve. See that file for why
 * the words live in the repository rather than in the database, and why not one
 * figure here is written as a figure.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE IS WRAPPED IN `__()`, AND THAT IS DELIBERATE
 *
 * Every interface string in this plugin is, and should be. This is not interface
 * text, it is the site's content: roughly twelve thousand words of French prose
 * for one market in one language (question 35). Putting it through the
 * translation layer would bury the four hundred strings a translator would
 * actually need under a body of copy nobody is going to translate, and would
 * make the .pot file useless for the thing it is for. The day a second language
 * is decided, this file is what gets duplicated, not annotated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE COPY GOES ON THE PAGE
 *
 * `intro` is one to three sentences ABOVE the product grid. `sections` go BELOW
 * it. That is measured rather than preferred: counting words of running text
 * before the first product link against after it, laboutiquedupro is 0 / 809,
 * tissus-print 25 / 1 764, vetement-publicitaire 42 / 1 049, label-blouse
 * 68 / 859 and la-manufacture 145 / 3 239. mistertee.fr puts 24 words above its
 * /t-shirts grid, all of them filter labels, and 2 822 below.
 *
 * `links` name a CONTENT KEY and never a URL. A page that has not been created
 * yet simply does not render its link, the way the masthead already works, so a
 * link into a 404 cannot ship.
 *
 * `after` is for a paragraph that comments on a list rather than introducing it,
 * because writing it as the last paragraph renders it above the list.
 *
 * GUARDED ON ABSPATH because `data/` answers HTTP: this directory is inside
 * wp-content/plugins and a plain request for this path must render nothing.
 *
 * @package Teeshoop\Core
 */

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

return array(

	'accueil' => array(
		'title'       => 'Textile personnalisé pour entreprises et associations',
		'description' => 'T-shirts, polos et sweats à votre logo, imprimés en France, à partir de {MINIMUM_PIECES} pièces. Le prix et la zone d’impression sont publiés avant la commande.',
		'h1'          => '',
		'intro'       => array(
		),
		'sections'    => array(
		),
	),

	'boutique' => array(
		'title'       => 'Le catalogue : t-shirts, polos et sweats à personnaliser',
		'description' => '{NB_REFERENCES} références à personnaliser, filtrables par grammage, matière, coloris et taille. Impression comprise dans le prix affiché.',
		'h1'          => 'Tous les textiles à personnaliser',
		'intro'       => array(
			'{NB_REFERENCES} références réparties en trois familles, chacune dans ses coloris et ses tailles. Le prix affiché comprend l’impression.',
			'Le panneau de gauche filtre sur le grammage, la matière, la marque, le coloris et la taille, et les nombres à côté de chaque case disent ce qu’il resterait si vous la cochiez.',
		),
		'sections'    => array(
			array(
				'h2'         => 'Trois familles, et rien d’autre au catalogue',
				'paragraphs' => array(
					'Nous imprimons des t-shirts, des polos et des sweats. Il n’y a ni veste de travail, ni haute visibilité, ni casquette, ni sac, ni tablier : autant le lire ici que le chercher dans les filtres.',
					'Le grammage de chaque référence est publié et filtrable. C’est le chiffre qui sépare deux vêtements identiques en photo, et c’est le premier que compare un acheteur professionnel.',
				),
				'links'      => array(
					array( 'label' => 'Les t-shirts', 'key' => 'categorie:t-shirts' ),
					array( 'label' => 'Les polos', 'key' => 'categorie:polos' ),
					array( 'label' => 'Les sweats', 'key' => 'categorie:sweats' ),
				),
			),
			array(
				'h2'         => 'Le coloris se cherche par la couleur, pas par son nom',
				'paragraphs' => array(
					'Un fabricant écrit « Heather Grey », un autre « Sport Grey », et ni l’un ni l’autre ne dit la teinte. Le catalogue porte {NB_COLORIS} noms de coloris, rangés en {NB_FAMILLES_COULEUR} familles de couleur mesurées sur le nuancier du fabricant et jamais déduites du nom.',
					'Les noms restent ceux du fabricant, parce que ce sont eux qui figurent sur l’étiquette et dans les catalogues papier, et que c’est ce nom-là qu’il faut avoir noté pour recommander la même chose l’an prochain.',
				),
			),
			array(
				'h2'         => 'Ce que le catalogue ne dit pas encore',
				'paragraphs' => array(
					'La plupart des références sont consultables et pas encore commandables en ligne : leur tarif n’est pas publié. Vous voyez la matière, le grammage, les coloris et les tailles, et le prix se demande par devis pour votre quantité.',
					'Les références commandables en autonomie portent leur grille de prix complète sur leur fiche, prix unitaire par palier de quantité, impression comprise.',
				),
				'links'      => array(
					array( 'label' => 'Demander un prix pour une référence', 'key' => 'page:devis' ),
				),
			),
			array(
				'h2'         => 'Vous savez déjà pour quoi faire',
				'paragraphs' => array(
					'Quatre pages partent du besoin plutôt que du vêtement, et disent d’avance ce que nous faisons et ce que nous ne faisons pas.',
				),
				'links'      => array(
					array( 'label' => 'Pour une association', 'key' => 'page:associations' ),
					array( 'label' => 'Pour un club sportif', 'key' => 'page:clubs-sportifs' ),
					array( 'label' => 'Pour un événement', 'key' => 'page:evenementiel' ),
					array( 'label' => 'Pour la restauration', 'key' => 'page:restauration' ),
				),
			),
		),
	),

	'categorie:t-shirts' => array(
		'title'       => 'T-shirt personnalisé entreprise, imprimé en France',
		'description' => 'T-shirts personnalisés avec votre logo, imprimés en France. Zone imprimable en centimètres sur chaque fiche, prix calculé sur la surface d’encre.',
		'h1'          => 'T-shirts personnalisés, imprimés en France',
		'intro'       => array(
			'Des t-shirts à personnaliser avec votre logo, imprimés en France, à partir de {MINIMUM_PIECES} pièces par commande, impression comprise dans le prix.',
			'Cette catégorie compte {NB_TSHIRTS} références. Chaque fiche publie sa zone imprimable en centimètres et sa grille de prix complète, prix unitaire par quantité pour cette référence, avant que vous ayez à demander un devis.',
		),
		'sections'    => array(
			array(
				'h2'         => 'Comment se commande un t-shirt personnalisé ici',
				'paragraphs' => array(
					'Tout le parcours est en libre-service, et le bon à tirer se valide en ligne sans créer de compte. Vous choisissez une référence dans cette catégorie, vous déposez votre visuel dans l’éditeur, vous le placez sur le devant, le dos ou une manche, et le prix de votre quantité s’affiche avant l’ajout au panier.',
					'L’éditeur montre le vêtement en 2D, en 3D et en réalité augmentée depuis un téléphone. L’intérêt n’est pas la démonstration : c’est de voir la taille réelle du marquage sur le vêtement avant de payer, plutôt que de la découvrir au déballage.',
					'La répartition des tailles se saisit ligne par ligne, avec sa quantité en face de chaque taille. Une série n’est presque jamais faite d’une seule taille.',
				),
				'list'       => array(
					'Choisir la référence, son coloris et son grammage.',
					'Déposer le visuel et le placer sur le devant, le dos ou une manche.',
					'Saisir la répartition des tailles, une ligne par taille.',
					'Vérifier le prix à votre quantité, impression comprise.',
					'Valider le bon à tirer en ligne, sans créer de compte.',
					'Expédition en Colissimo, {DELAI_STANDARD} jours ouvrés après la validation du bon à tirer.',
				),
				'after'      => array(
					'Aucune de ces étapes ne passe par un e-mail. Le devis existe pour ce que le site ne sait pas chiffrer seul, il n’est pas un passage obligé.',
				),
			),
			array(
				'h2'         => 'Jusqu’où vous pouvez imprimer, en centimètres',
				'paragraphs' => array(
					'La zone imprimable est publiée sur chaque fiche, en centimètres. Pour un t-shirt en taille {TAILLE_MESUREE}, face avant, elle mesure {ZONE_TSHIRT}. C’est une dimension, pas un nom de zone.',
					'La question qu’un acheteur se pose n’est pas « quelle technique » mais « est-ce que mon logo tient ». Un chiffre en centimètres se reporte à la règle sur un vêtement que vous avez déjà, et vous savez avant de commander si votre visuel y entre.',
					'Nous publions ces centimètres parce que nous facturons de la surface. Tant que le prix ne dépend que du vêtement, un nom de zone suffit. À partir du moment où il dépend de ce que vous imprimez, la dimension fait partie du prix, et la garder pour soi n’est plus tenable.',
				),
			),
			array(
				'h2'         => 'Le prix est calculé sur la surface d’encre, pas sur votre fichier',
				'paragraphs' => array(
					'Le prix comprend l’impression. Il n’y a pas le textile d’un côté et le marquage de l’autre, ni de ligne qui apparaît au panier.',
					'La surface facturée est celle de l’encre réellement imprimée, pas celle du rectangle dans lequel le fichier a été déposé. Un logo exporté avec de larges marges transparentes, ou un visuel détouré, n’occupe qu’une petite partie de son fichier. Vous payez le dessin, pas le vide autour.',
					'La conséquence est bonne à connaître avant d’exporter. Un fichier sans transparence, un JPEG par exemple, n’a pas de marge transparente : son rectangle entier compte comme surface imprimée, fond compris. Un PNG détouré, non. À visuel identique, les deux fichiers ne coûtent pas la même chose.',
					'La grille complète est publiée sur chaque fiche produit, prix unitaire par quantité. Vous chiffrez votre série vous-même, avant d’ouvrir l’éditeur.',
				),
				'links'      => array(
					array( 'label' => 'Préparer et exporter votre fichier d’impression', 'key' => 'page:fichiers-impression' ),
				),
			),
			array(
				'h2'         => 'Le minimum de commande et le palier de quantité',
				'paragraphs' => array(
					'Deux règles de quantité s’appliquent à une commande de t-shirts, et elles ne se comptent pas sur le même périmètre.',
				),
				'list'       => array(
					'Le minimum de commande, {MINIMUM_PIECES} pièces, compté sur le panier entier, toutes références confondues. Aucun montant minimum ne s’y ajoute.',
					'Le palier de quantité, celui qui fait baisser le prix unitaire : il se compte sur la quantité d’une même référence, avec le même visuel.',
					'La répartition des tailles : les quantités saisies s’additionnent à l’intérieur de la même ligne, donc mélanger les tailles ne fait pas perdre le palier.',
				),
				'after'      => array(
					'Mélanger les modèles, en revanche, ne les additionne pas : des t-shirts et des polos commandés ensemble gardent chacun leur palier. La même quantité regroupée sur une seule référence revient donc moins cher qu’éclatée sur trois modèles. C’est un arbitrage de prix qui vous appartient, au même titre que la taille du visuel.',
					'En dessous du minimum, le panier refuse la commande et indique ce qui manque, en pièces et en montant. Il vaut mieux le lire ici que le découvrir au moment de payer.',
					'Le libre-service a aussi un plafond : au-delà de {SEUIL_DEVIS} pièces sur une même ligne, nous chiffrons la commande à la main, le panier vous renvoie vers un devis et votre création est conservée.',
				),
				'links'      => array(
					array( 'label' => 'Demander un devis pour un cas particulier', 'key' => 'page:devis' ),
					array( 'label' => 'T-shirts pour une association', 'key' => 'page:associations' ),
				),
			),
			array(
				'h2'         => 'Choisir sa référence : grammage, coloris, tailles',
				'paragraphs' => array(
					'Le catalogue tient en trois familles, t-shirts, polos et sweats, pour {NB_REFERENCES} références au total, dont {NB_TSHIRTS} dans cette catégorie.',
					'Le grammage de chaque référence est publié, et il est filtrable. Il se lit en grammes par mètre carré, et c’est le chiffre qui sépare deux t-shirts qui se ressemblent en photo. Vous écartez en une fois ce qui est trop léger pour un vêtement porté tous les jours, ou trop épais pour un événement en plein été.',
					'Le catalogue, toutes familles confondues, porte {NB_COLORIS} noms de coloris, et un nom ne dit pas une couleur : deux fabricants n’appellent pas le même bleu « bleu roi ». Les {NB_FAMILLES_COULEUR} familles de couleur du filtre ont été mesurées sur le nuancier du fabricant, pas déduites du nom. Un filtre « vert » ramène donc des verts, quel que soit leur nom.',
					'La disponibilité se lit ensuite article par article, un coloris dans une taille, et pas au niveau de la référence : une référence présente au catalogue ne garantit pas que votre taille existe dans votre coloris.',
				),
				'links'      => array(
					array( 'label' => 'Voir les polos personnalisés', 'key' => 'categorie:polos' ),
					array( 'label' => 'Voir les sweats personnalisés', 'key' => 'categorie:sweats' ),
				),
			),
			array(
				'h2'         => 'Le marquage : le DTF en ligne, le reste en devis',
				'paragraphs' => array(
					'Une seule technique se commande en autonomie sur ce site : le DTF, un transfert imprimé puis pressé sur le vêtement. C’est celle que l’éditeur sait mesurer et chiffrer au centimètre carré, donc c’est celle que vous pouvez commander sans nous écrire.',
					'La broderie, le flocage et la sublimation existent et passent par un devis. La broderie est sous-traitée : elle ne sort pas de notre atelier, et nous n’annonçons donc pas de délai pour elle.',
				),
			),
			array(
				'h2'         => 'Fabrication, délai et livraison',
				'paragraphs' => array(
					'Le délai est de {DELAI_STANDARD} jours ouvrés entre la validation du bon à tirer et l’expédition. Il ne part pas de la commande, il part de votre validation : tant que le bon à tirer n’est pas validé, rien n’est lancé, et c’est la seule partie du délai qui dépend de vous.',
					'Nous ne publions que le délai que l’atelier tient, et il n’y en a pas d’autre à commander sur ce site.',
					'L’impression et la pose sont faites en France, dans notre atelier. La livraison est assurée en Colissimo, en France continentale. Les autres destinations se chiffrent en devis.',
					'Nous écrivons « imprimé en France », pas « fabriqué en France ». Le vêtement nu, nous ne le tissons pas : ce qui est fait ici, c’est le marquage. La distinction compte pour une collectivité ou une association qui doit justifier son achat.',
				),
			),
		),
		'faq'         => array(
			array(
				'q' => 'Puis-je commander un seul t-shirt personnalisé ?',
				'a' => 'Non. Le minimum est de {MINIMUM_PIECES} pièces par commande, comptées sur le panier entier. Ces pièces peuvent être réparties sur plusieurs tailles, plusieurs coloris et plusieurs références.',
			),
			array(
				'q' => 'Est-ce que plusieurs modèles s’additionnent pour atteindre un palier de prix ?',
				'a' => 'Non. Le palier se compte sur la quantité d’une même référence, avec le même visuel : des t-shirts et des polos commandés ensemble gardent chacun le leur. Le minimum de commande, lui, se compte bien sur le panier entier. Regrouper la quantité sur une seule référence revient donc moins cher que l’éclater sur trois modèles.',
			),
			array(
				'q' => 'Combien coûte un t-shirt personnalisé avec un logo ?',
				'a' => 'Cela dépend de la référence, de la quantité et de la surface imprimée, donc il n’y a pas un prix unique à afficher ici. La grille complète, prix unitaire par quantité pour une même référence, est publiée sur chaque fiche produit, et le prix comprend l’impression. Le prix de votre configuration s’affiche dans l’éditeur avant l’ajout au panier.',
			),
			array(
				'q' => 'Mon logo est un JPEG avec un fond blanc. Est-ce que je paie le fond ?',
				'a' => 'Oui. Le prix est calculé sur la surface d’encre imprimée, et un fichier sans transparence n’a pas de marge transparente : tout son rectangle est imprimé. Avec un PNG détouré, seule la surface du dessin est facturée.',
			),
			array(
				'q' => 'Faites-vous de la broderie ?',
				'a' => 'Oui, en devis, pas en ligne. La broderie est sous-traitée : elle ne sort pas de notre atelier et nous n’annonçons pas de délai pour elle. En autonomie sur le site, la seule technique est le DTF.',
			),
			array(
				'q' => 'Sous combien de temps je reçois ma commande ?',
				'a' => '{DELAI_STANDARD} jours ouvrés entre la validation de votre bon à tirer et l’expédition, puis le transport Colissimo. Nous ne publions que le délai que l’atelier tient, et il n’y en a pas d’autre à commander sur ce site.',
			),
			array(
				'q' => 'Est-ce que je vois le t-shirt avant de payer ?',
				'a' => 'Oui. L’éditeur affiche le vêtement en 2D, en 3D et en réalité augmentée, avec la zone imprimable en centimètres, soit {ZONE_TSHIRT} pour un t-shirt en taille {TAILLE_MESUREE}, face avant. Après la commande, le bon à tirer se valide en ligne sans créer de compte, et rien n’est imprimé avant.',
			),
		),
	),

	'categorie:polos' => array(
		'title'       => 'Polo personnalisé entreprise : DTF, broderie sur devis',
		'description' => 'Polos personnalisés imprimés en France, à partir de {MINIMUM_PIECES} pièces. Impression DTF en ligne, broderie sur devis.',
		'h1'          => 'Polos personnalisés pour entreprises et associations',
		'intro'       => array(
			'{NB_POLOS} références de polos, imprimés en France, à partir de {MINIMUM_PIECES} pièces.',
			'L’impression DTF se commande en ligne, avec le prix affiché avant l’ajout au panier. La broderie passe par un devis : elle est sous-traitée.',
		),
		'sections'    => array(
			array(
				'h2'         => 'Ce qui se commande seul, ce qui passe par un devis',
				'paragraphs' => array(
					'Une seule technique se commande en autonomie sur ce site : le DTF. Le visuel est imprimé sur un film, puis pressé sur le polo. Vous choisissez la référence, la quantité et les tailles, et le prix s’affiche avant l’ajout au panier.',
					'La broderie n’est pas produite dans notre atelier, elle est sous-traitée : nous n’affichons donc ni sa grille de prix ni son délai. Le flocage et la sublimation passent eux aussi par un devis.',
				),
				'list'       => array(
					'En ligne, sans devis : impression DTF.',
					'Sur devis : broderie (sous-traitée), flocage, sublimation.',
					'Délai publié : {DELAI_STANDARD} jours ouvrés en DTF, entre la validation du bon à tirer et l’expédition.',
				),
				'links'      => array(
					array( 'label' => 'Demander un devis', 'key' => 'page:devis' ),
				),
			),
			array(
				'h2'         => 'La patte de boutonnage limite la surface imprimable',
				'paragraphs' => array(
					'Sur un t-shirt, la face avant est une surface libre : {ZONE_TSHIRT} sur une taille {TAILLE_MESUREE}. Un polo, non. La patte de boutonnage et le col réduisent la surface disponible, et une presse a besoin d’une zone plate, sans bouton ni surépaisseur.',
					'Cette dimension en centimètres est celle du t-shirt. Pour un polo, l’emplacement et la taille retenus sont ceux que montre le bon à tirer, validé avant toute production.',
				),
				'links'      => array(
					array( 'label' => 'T-shirts personnalisés', 'key' => 'categorie:t-shirts' ),
				),
			),
			array(
				'h2'         => 'Ce que le prix affiché contient',
				'paragraphs' => array(
					'Le prix comprend le polo et l’impression. Aucun frais de marquage ne s’ajoute au panier ensuite.',
					'Le calcul porte sur la surface d’encre réellement imprimée, pas sur le rectangle dans lequel le fichier a été déposé. Un logo livré avec de larges marges transparentes n’est pas facturé sur ses marges.',
					'Le prix baisse par palier de quantité, et la grille complète est publiée sur chaque fiche produit : le prix unitaire par quantité et par nombre de faces imprimées, lisible sans ouvrir l’éditeur et sans créer de compte. Ce palier se lit sur une ligne de panier, jamais sur le total du panier.',
				),
				'list'       => array(
					'Une ligne de panier, c’est un polo, un visuel et une répartition de tailles ajoutés en une fois. C’est la quantité de cette ligne qui fixe le palier, et répartir cette quantité entre plusieurs tailles ne la coupe pas.',
					'Une deuxième référence, un deuxième coloris ou un deuxième visuel font une deuxième ligne, avec son propre palier. Les quantités des deux lignes ne s’additionnent pas.',
					'Le minimum de commande, lui, se compte bien sur le panier entier : {MINIMUM_PIECES} pièces, toutes références confondues.',
				),
				'after'      => array(
					'À nombre de pièces égal, regrouper la quantité sur une même référence revient donc moins cher que la répartir sur plusieurs modèles.',
				),
				'links'      => array(
					array( 'label' => 'Préparer son fichier d’impression', 'key' => 'page:fichiers-impression' ),
				),
			),
			array(
				'h2'         => 'Choisir une référence dans la liste',
				'paragraphs' => array(
					'La catégorie contient {NB_POLOS} références. Le panneau de filtres accepte un grammage minimum et maximum, en grammes par mètre carré.',
					'Le catalogue compte {NB_COLORIS} noms de coloris, regroupés en {NB_FAMILLES_COULEUR} familles de couleur. Ces familles sont mesurées sur le nuancier du fabricant et non déduites du nom du coloris : deux références peuvent appeler « bleu roi » deux bleus différents, et c’est la mesure qui tranche.',
					'Ces {NB_POLOS} polos font partie d’un catalogue de {NB_REFERENCES} références, chacune déclinée en coloris et en tailles.',
				),
			),
			array(
				'h2'         => 'Répartir les tailles dans une seule commande',
				'paragraphs' => array(
					'La répartition des tailles se saisit taille par taille, une quantité en face de chacune, dans la même commande. Il n’y a pas à passer une commande par taille, et cette répartition reste une seule ligne de panier.',
					'Le minimum est de {MINIMUM_PIECES} pièces, comptées sur le panier entier et non par référence. En dessous, le panier indique combien il en manque.',
					'Le bon à tirer se valide en ligne, sans créer de compte. C’est utile quand la personne qui contrôle le logo n’est pas celle qui a passé la commande, et cela évite un aller-retour de pièces jointes par courriel.',
				),
				'links'      => array(
					array( 'label' => 'Polos pour clubs sportifs', 'key' => 'page:clubs-sportifs' ),
					array( 'label' => 'Commander en petite série', 'key' => 'page:petites-series' ),
				),
			),
			array(
				'h2'         => 'Délai et livraison',
				'paragraphs' => array(
					'{DELAI_STANDARD} jours ouvrés séparent la validation du bon à tirer et l’expédition. Le décompte démarre à votre validation et non à la commande : un visuel qui attend votre réponse n’entame pas le délai.',
					'La livraison se fait en Colissimo, en France métropolitaine. Le transport s’ajoute à ces jours ouvrés, il n’y est pas compris.',
					'Il n’y a qu’un délai sur ce site, celui annoncé ci-dessus, et c’est celui que la production tient.',
				),
			),
		),
		'faq'         => array(
			array(
				'q' => 'Puis-je commander des polos brodés directement sur le site ?',
				'a' => 'Non. La broderie est sous-traitée : elle n’est pas produite dans notre atelier, donc elle passe par un devis et nous n’annonçons pas de délai pour elle. Ce qui se commande seul, c’est l’impression DTF. Une demande de devis reprend la référence du polo, la quantité, les tailles et l’emplacement du logo.',
			),
			array(
				'q' => 'Quelle différence entre le DTF et la broderie sur un polo ?',
				'a' => 'Le DTF est une impression : le visuel est imprimé sur un film, puis pressé sur le vêtement. Il accepte les dégradés et les photographies, et il se commande en ligne. La broderie est un fil cousu dans la maille, et elle passe par un devis.',
			),
			array(
				'q' => 'Quel est le minimum de commande ?',
				'a' => '{MINIMUM_PIECES} pièces, comptées sur le panier entier et non par référence, donc les polos, les t-shirts et les sweats d’un même panier s’additionnent pour l’atteindre. En dessous, le panier indique combien il en manque.',
			),
			array(
				'q' => 'Le prix baisse-t-il si j’additionne plusieurs modèles ?',
				'a' => 'Non. Le palier de quantité se lit sur la quantité d’une même ligne de panier, c’est-à-dire d’une même référence avec son visuel, et non sur le total du panier. Mélanger des références sert à atteindre le minimum de commande, pas à faire baisser le prix unitaire. À nombre de pièces égal, une seule référence avec sa répartition de tailles atteint un palier plus haut que la même quantité éclatée sur trois modèles.',
			),
			array(
				'q' => 'Sous quel délai les polos partent-ils ?',
				'a' => '{DELAI_STANDARD} jours ouvrés entre la validation du bon à tirer et l’expédition, puis le transport en Colissimo, France métropolitaine.',
			),
			array(
				'q' => 'Le prix affiché comprend-il l’impression ?',
				'a' => 'Oui, le polo et l’impression sont dans le même prix, et la grille complète par quantité et par nombre de faces est publiée sur chaque fiche produit. Le calcul porte sur la surface d’encre imprimée, donc les marges transparentes d’un fichier ne sont pas facturées.',
			),
			array(
				'q' => 'Puis-je voir le marquage avant qu’il soit produit ?',
				'a' => 'Oui. Un bon à tirer se valide en ligne, sans créer de compte : il montre le visuel à son emplacement et à sa taille sur le vêtement choisi. Rien ne part en production avant cette validation, et c’est elle qui déclenche le décompte des {DELAI_STANDARD} jours ouvrés.',
			),
		),
	),

	'categorie:sweats' => array(
		'title'       => 'Sweat personnalisé et sweat à capuche imprimés en France',
		'description' => 'Sweats à personnaliser en DTF, impression comprise, à partir de {MINIMUM_PIECES} pièces. Zone imprimable en centimètres.',
		'h1'          => 'Sweat personnalisé, imprimé en France',
		'intro'       => array(
			'Cette catégorie réunit {NB_SWEATS} références de sweats, filtrables par grammage, par matière et par famille de coloris.',
			'L’impression est comprise dans le prix, en DTF, à partir de {MINIMUM_PIECES} pièces par commande. Le prix à la pièce baisse ensuite par palier, sur la quantité d’une même référence.',
			'Sur un sweat, la capuche et la poche kangourou décident de ce que vous pouvez imprimer, et la zone se lit en centimètres dans l’éditeur, avant l’ajout au panier.',
		),
		'sections'    => array(
			array(
				'h2'         => 'Le grammage, avant la marque et avant la couleur',
				'paragraphs' => array(
					'Le grammage est la densité du molleton, en grammes par mètre carré. C’est ce qui sépare deux sweats qui se ressemblent en photo. Chaque référence publie le sien, et le filtre de cette page prend un minimum et un maximum.',
					'Quand le fabricant annonce un grammage différent selon le coloris, la fiche le dit plutôt que de publier un chiffre unique qui serait faux pour un coloris. La composition est reprise telle que le fabricant l’écrit, exception de coloris comprise.',
					'La boutique tient {NB_REFERENCES} références, toutes familles confondues. Un sweat qui n’existe pas dans votre taille n’apparaît pas : les tailles et les coloris proposés sont ceux que le fournisseur vend réellement.',
				),
			),
			array(
				'h2'         => 'La capuche et la poche kangourou décident de la zone',
				'paragraphs' => array(
					'Sur la face avant d’un sweat à capuche, la zone imprimable s’arrête au-dessus de la poche kangourou. Plus bas, le molleton n’est plus à plat : la presse appuierait sur l’ourlet de la poche au lieu du vêtement.',
					'La zone du sweat se lit en centimètres dans l’éditeur, face par face. Elle est plus courte que sur un t-shirt de la même taille, dont la face avant mesure {ZONE_TSHIRT} en taille {TAILLE_MESUREE}.',
				),
				'list'       => array(
					'Face avant : le visuel s’arrête au-dessus de la poche.',
					'Dos : la zone est plus courte que sur un t-shirt, la capuche retombant sur le haut du dos.',
					'Manche : une petite zone, de quoi placer un logo secondaire.',
					'Capuche et poche : nous n’y imprimons pas.',
				),
				'after'      => array(
					'Par défaut, le visuel est gradué avec la taille du vêtement : plus grand sur un 3XL que sur un S, dans la même proportion que le sweat. Vous pouvez aussi choisir une impression unique, qui garde la même dimension sur toutes les tailles.',
				),
				'links'      => array(
					array( 'label' => 'La catégorie t-shirts', 'key' => 'categorie:t-shirts' ),
				),
			),
			array(
				'h2'         => 'Ce que le prix comprend',
				'paragraphs' => array(
					'Le prix affiché comprend l’impression. Il baisse par palier de quantité, et le palier se calcule ligne par ligne : une ligne, c’est une référence dans un coloris, avec sa répartition de tailles.',
					'Les tailles saisies sur cette ligne comptent donc ensemble. Un autre modèle ou un autre coloris ouvre une autre ligne, avec sa propre quantité et son propre palier : trente pièces réparties sur trois modèles comptent comme trois lots de dix, jamais comme un lot de trente. Une série qui tient sur une même référence coûte moins cher que la même quantité étalée sur trois.',
					'Vous payez la surface d’encre réellement imprimée, mesurée sur votre visuel, et non le rectangle du fichier. Un logo entouré de marges transparentes est facturé sur son encre.',
					'Sur un sweat personnalisable en ligne, la grille est publiée sur la fiche avant même d’ouvrir l’éditeur : une colonne par quantité, une ligne par nombre de faces imprimées, le prix à la pièce dans chaque case. Au pied de la grille, la surface par face jusqu’à laquelle ces prix valent, et ce qui s’ajoute au-delà.',
					'Nous produisons à partir de {MINIMUM_PIECES} pièces. Ce minimum, lui, se compte sur le panier entier, toutes références confondues : le panier vous dit combien il en manque.',
				),
				'links'      => array(
					array( 'label' => 'Commander une petite série', 'key' => 'page:petites-series' ),
				),
			),
			array(
				'h2'         => 'Le DTF en autonomie, la broderie sur devis',
				'paragraphs' => array(
					'Une seule technique se commande sans passer par un devis : le DTF. Le visuel est imprimé sur un film, puis pressé sur le vêtement. Il n’impose pas de limite de couleurs, ce qui convient à un logo en dégradé comme à un blason de club.',
					'La broderie, le flocage et la sublimation existent, mais passent par un devis. La broderie est confiée à un atelier extérieur : elle n’est pas faite chez nous, et nous n’affichons aucun délai pour elle tant que nous ne pouvons pas le tenir.',
					'Le devis ne sert pas qu’aux autres techniques. Au-delà de {SEUIL_DEVIS} pièces sur une même ligne, ou du montant hors taxes indiqué sous la grille de prix, nous chiffrons la commande à la main plutôt que de la laisser passer au paiement.',
					'Pour une demande, indiquez la référence, la quantité, la répartition des tailles et ce que vous voulez marquer.',
				),
				'links'      => array(
					array( 'label' => 'Demander un devis', 'key' => 'page:devis' ),
				),
			),
			array(
				'h2'         => 'Retrouver un coloris précis',
				'paragraphs' => array(
					'Un fabricant écrit « French Navy » là où un autre écrit « Marine », et les deux ne sont pas la même teinte. La boutique porte {NB_COLORIS} noms de coloris, tous écrits par des fabricants qui ne nomment pas les couleurs de la même façon.',
					'Nous les avons regroupés en {NB_FAMILLES_COULEUR} familles, mesurées sur le nuancier du fabricant et non déduites du nom. Le filtre de cette page travaille sur ces familles : chercher un bleu ne dépend donc pas de la façon dont chaque marque nomme le sien.',
					'Un écran reste un écran. La pastille affichée vient d’une mesure du nuancier, pas d’une photo du vêtement. Si le sweat doit s’accorder à une enseigne ou à une charte déjà en place, dites-le dans votre demande de devis.',
				),
			),
			array(
				'h2'         => 'De l’éditeur à l’expédition',
				'paragraphs' => array(
					'L’éditeur en ligne montre le sweat en 2D, en 3D et en réalité augmentée. Le prix s’affiche avant l’ajout au panier, pas au moment de payer.',
					'La répartition des tailles se saisit taille par taille, sur la même ligne de commande. Le bon à tirer se valide en ligne, sans créer de compte.',
					'Comptez {DELAI_STANDARD} jours ouvrés entre votre validation du bon à tirer et l’expédition. Le délai part de cette validation : tant que le bon à tirer attend une réponse, l’atelier attend aussi. L’acheminement se fait ensuite en Colissimo, France métropolitaine.',
					'Nous n’affichons pas de délai plus court, parce que l’atelier ne le tient pas.',
				),
			),
			array(
				'h2'         => 'Selon qui porte le sweat',
				'paragraphs' => array(
					'Un club commande beaucoup de tailles en une fois ; une entreprise revient plus tard avec une autre série.',
				),
				'list'       => array(
					'Entreprises : le marquage cœur et le dos, sur une série qui habille une équipe.',
					'Clubs et associations : beaucoup de tailles différentes dans une même série, ce qui ne change rien au palier tant que la série reste sur une même référence.',
					'Écoles et événements : une date d’usage, à laquelle il faut remonter les {DELAI_STANDARD} jours ouvrés de production, puis l’acheminement.',
				),
				'after'      => array(
					'Ces cas ont chacun leur page, celle-ci reste sur le vêtement.',
				),
				'links'      => array(
					array( 'label' => 'Les sweats en entreprise', 'key' => 'page:entreprises' ),
					array( 'label' => 'Sweats de club sportif', 'key' => 'page:clubs-sportifs' ),
				),
			),
		),
		'faq'         => array(
			array(
				'q' => 'Faites-vous des sweats brodés ?',
				'a' => 'La broderie ne se commande pas en ligne ici : elle passe par un devis et elle est confiée à un atelier extérieur, donc nous n’annonçons pas de délai pour elle. En autonomie sur le site, la technique disponible est le DTF.',
			),
			array(
				'q' => 'Quelle taille peut faire mon visuel sur un sweat à capuche ?',
				'a' => 'L’éditeur affiche la zone en centimètres, face par face, avant l’ajout au panier. Sur la face avant, elle s’arrête au-dessus de la poche kangourou : elle est donc plus courte que sur un t-shirt de la même taille, dont la face avant mesure {ZONE_TSHIRT} en taille {TAILLE_MESUREE}. Par défaut, le visuel est gradué avec la taille du vêtement.',
			),
			array(
				'q' => 'Peut-on imprimer sur la capuche, sur la poche ou en travers d’une fermeture ?',
				'a' => 'Non. Nous imprimons la face avant, le dos et la manche. Un visuel centré ne peut pas traverser une fermeture : sur un sweat zippé, il se place d’un côté ou au dos, et le bon à tirer vous montre l’emplacement retenu avant lancement.',
			),
			array(
				'q' => 'Combien de sweats faut-il commander au minimum ?',
				'a' => 'À partir de {MINIMUM_PIECES} pièces, comptées sur le panier entier : des sweats, des t-shirts et des polos commandés ensemble atteignent ce minimum. En dessous, le panier le dit et propose un devis.',
			),
			array(
				'q' => 'Commander plusieurs modèles fait-il baisser le prix à la pièce ?',
				'a' => 'Non, et c’est plutôt l’inverse. Le palier de quantité se calcule ligne par ligne, sur la quantité d’une même référence dans un même coloris. Dix sweats, dix polos et dix t-shirts font trois lots de dix, pas un lot de trente, et chaque lot est facturé au palier qu’il atteint tout seul. Regrouper la série sur une même référence coûte donc moins cher que la répartir sur trois modèles. Seul le minimum de commande, lui, additionne tout le panier.',
			),
			array(
				'q' => 'Sous quel délai la commande part-elle de l’atelier ?',
				'a' => '{DELAI_STANDARD} jours ouvrés entre votre validation du bon à tirer et l’expédition, puis l’acheminement en Colissimo, France métropolitaine. Nous ne vendons pas de délai plus court, parce que l’atelier ne le tient pas.',
			),
			array(
				'q' => 'Peut-on mettre un prénom ou un numéro différent sur chaque sweat ?',
				'a' => 'Pas en autonomie : sur le site, un visuel vaut pour toute la ligne, quelles que soient les tailles saisies. Pour un marquage qui change d’une pièce à l’autre, demandez un devis en joignant la liste des prénoms ou des numéros.',
			),
		),
	),

	'page:entreprises' => array(
		'title'       => 'Vêtements personnalisés pour entreprise : devis et facture',
		'description' => 'T-shirts, polos et sweats à votre logo pour équiper vos équipes : facture à votre raison sociale, réassort à l’identique, imprimé en France.',
		'h1'          => 'Vêtements personnalisés pour entreprise : t-shirts, polos, sweats',
		'intro'       => array(
			'Trois familles au catalogue : t-shirts, polos et sweats, soit {NB_REFERENCES} références déclinées en coloris et en tailles.',
			'Une commande démarre à {MINIMUM_PIECES} pièces, comptées sur le panier entier, vêtements et tailles mélangés.',
			'Les dimensions imprimables sont publiées en centimètres sur chaque fiche, et le prix s\'affiche avant l\'ajout au panier.',
		),
		'sections'    => array(
			array(
				'h2'         => 'Ce que la fiche produit dit avant la commande',
				'paragraphs' => array(
					'L\'éditeur en ligne pose votre visuel sur le vêtement et vous le montre en 2D, en 3D et en réalité augmentée. Le prix apparaît avant l\'ajout au panier, sans formulaire à remplir d\'abord.',
					'Chaque fiche publie les mêmes quatre choses, pour toutes les références :',
				),
				'list'       => array(
					'la zone imprimable, en centimètres',
					'le grammage de la référence',
					'le coloris, avec sa famille de couleur mesurée',
					'la grille de prix par quantité',
				),
				'after'      => array(
					'Sur un t-shirt en taille {TAILLE_MESUREE}, la face avant mesure {ZONE_TSHIRT}. Vous savez donc si votre visuel y tient avant de commander, et pas après.',
					'« Cœur », « A3 » ou « grand dos » sont du vocabulaire d\'atelier. Un nombre en centimètres, lui, se compare à un objet que vous avez sous la main. C\'est pour cette raison que la fiche donne un nombre et pas un nom de format, et que le bon à tirer le reprend.',
				),
				'links'      => array(
					array( 'label' => 'Le catalogue des t-shirts', 'key' => 'categorie:t-shirts' ),
				),
			),
			array(
				'h2'         => 'Ce qui est facturé, et ce qui fait baisser le prix',
				'paragraphs' => array(
					'Le prix comprend l\'impression. Quand vous comparez des devis, vérifiez si le marquage est dans le prix du vêtement ou sur une ligne à part : les deux chiffres ne se comparent pas directement.',
					'La surface facturée est celle de l\'encre réellement posée sur le textile, pas celle du rectangle dans lequel le fichier a été déposé. Un logo exporté avec de larges marges transparentes n\'est donc pas facturé sur ses marges.',
					'Le prix unitaire baisse ensuite par palier de quantité. Deux règles de quantité coexistent, et elles ne se comptent pas au même endroit :',
				),
				'list'       => array(
					'le palier de quantité se lit sur une seule ligne de commande, c\'est-à-dire un même vêtement mis au panier en une fois, toutes tailles confondues',
					'le minimum de commande se lit sur le panier entier : {MINIMUM_PIECES} pièces, toutes références confondues',
				),
				'after'      => array(
					'Trente pièces d\'un même vêtement comptent donc comme trente. Les mêmes trente réparties sur trois modèles comptent comme trois fois dix, et chaque ligne est remisée sur sa propre quantité, pas sur le total du panier.',
					'Mélanger des modèles vous fait atteindre le minimum, jamais le palier. À nombre de pièces égal, regrouper la quantité sur un seul vêtement coûte moins cher que de la répartir sur trois.',
				),
				'links'      => array(
					array( 'label' => 'Préparer un fichier d\'impression', 'key' => 'page:fichiers-impression' ),
					array( 'label' => 'Commander une petite série', 'key' => 'page:petites-series' ),
				),
			),
			array(
				'h2'         => 'Le grammage et le coloris sont publiés, pas décrits',
				'paragraphs' => array(
					'Le grammage de chaque référence est publié et filtrable. Un t-shirt léger et un t-shirt épais ne se portent pas de la même façon et ne coûtent pas la même chose : deux devis peuvent porter sur deux grammages différents sans que ni l\'un ni l\'autre ne le dise.',
					'Le catalogue compte {NB_COLORIS} noms de coloris, regroupés en {NB_FAMILLES_COULEUR} familles de couleur. La famille est mesurée sur le nuancier du fabricant et non déduite du nom : deux noms voisins désignent parfois deux teintes éloignées, et deux noms sans rapport tombent parfois dans la même famille. Vous filtrez donc sur une couleur constatée.',
					'Côté volume, cela fait {NB_TSHIRTS} t-shirts, {NB_POLOS} polos et {NB_SWEATS} sweats à comparer, grammage par grammage.',
				),
				'links'      => array(
					array( 'label' => 'Les polos et leurs grammages', 'key' => 'categorie:polos' ),
				),
			),
			array(
				'h2'         => 'Le DTF en autonomie, la broderie sur devis',
				'paragraphs' => array(
					'Sur ce site, la technique disponible en autonomie est le DTF, et lui seul. C\'est celle que l\'atelier opère, du fichier jusqu\'à la presse.',
					'La broderie, le flocage et la sublimation existent et passent par un devis. La broderie est sous-traitée : elle ne sort pas de notre atelier, et nous ne publions pas de délai pour elle, parce que ce délai serait tenu par l\'atelier de broderie et pas par nous.',
					'Le catalogue tient trois familles : t-shirts, polos et sweats. Une veste ou un tablier n\'y sont pas aujourd\'hui, et nous préférons ne pas ouvrir une fiche pour un vêtement que nous ne pouvons pas expédier.',
				),
				'links'      => array(
					array( 'label' => 'Demander un devis', 'key' => 'page:devis' ),
				),
			),
			array(
				'h2'         => 'Du bon à tirer au colis',
				'paragraphs' => array(
					'Rien n\'est imprimé tant que vous n\'avez pas validé le bon à tirer. Il arrive par courriel, s\'ouvre dans le navigateur et se valide en ligne : le gérant ou le trésorier qui décide n\'a pas de compte à créer pour signer.',
					'Le document reprend la référence, le coloris, la technique, la quantité, la surface imprimée en centimètres carrés et la hauteur du centre de la zone sous l\'encolure. C\'est ce qui part en production.',
					'Une réserve, et elle est sérieuse : les couleurs d\'un écran ne sont pas celles d\'un textile imprimé. Jugez le placement et les dimensions sur l\'aperçu, pas la teinte exacte. Si quelque chose ne va pas, demandez la modification depuis la même page et une nouvelle version vous est envoyée.',
					'L\'impression se fait ensuite dans notre atelier, en France. Comptez {DELAI_STANDARD} jours ouvrés entre votre validation et l\'expédition. Le colis part en Colissimo, pour la France métropolitaine.',
				),
			),
		),
		'faq'         => array(
			array(
				'q' => 'Quel est le minimum de commande ?',
				'a' => '{MINIMUM_PIECES} pièces, comptées sur le panier entier. Les vêtements et les tailles se mélangent pour les atteindre : des t-shirts et des sweats dans le même panier comptent ensemble. Nous n\'imprimons pas de pièce isolée, parce que le film et le calage de la presse se préparent par série et qu\'une pièce seule porterait à elle seule ce travail.',
			),
			array(
				'q' => 'Le prix baisse-t-il si j\'additionne plusieurs modèles ?',
				'a' => 'Non, et c\'est le contraire. Le palier de quantité se calcule sur une seule ligne de commande, c\'est-à-dire sur un même vêtement mis au panier en une fois. Vingt t-shirts et dix polos dans le même panier ne font pas une quantité de trente : ils font vingt d\'un côté et dix de l\'autre, et chaque ligne est remisée sur son propre nombre. Seul le minimum de commande, lui, additionne tout le panier.',
			),
			array(
				'q' => 'Sous combien de temps la commande part-elle ?',
				'a' => '{DELAI_STANDARD} jours ouvrés entre la validation du bon à tirer et l\'expédition, puis Colissimo pour la France métropolitaine. Le décompte démarre à votre validation : tant que le bon à tirer attend une réponse, la production n\'est pas lancée. Nous ne proposons pas de délai plus court, parce que nous ne le tiendrions pas.',
			),
			array(
				'q' => 'Faites-vous de la broderie, et sur des vestes ?',
				'a' => 'La broderie, oui, sur devis, et elle est sous-traitée : elle ne se commande pas en ligne et nous n\'annonçons pas de délai pour elle. Les vestes, non : le catalogue tient trois familles, t-shirts, polos et sweats.',
			),
			array(
				'q' => 'Mon logo a un fond blanc, est-ce que je paie cette surface ?',
				'a' => 'Oui. En DTF le blanc est une encre : il est imprimé comme les autres couleurs, donc il est mesuré comme les autres couleurs. Un fichier au fond transparent, un PNG détouré par exemple, n\'est facturé que sur son encre et pas sur ses marges.',
			),
			array(
				'q' => 'Nous avons des tailles très différentes dans l\'équipe, comment commander ?',
				'a' => 'Vous saisissez la quantité par taille sur une même ligne de commande, sans passer une commande par taille. Ces tailles comptent ensemble pour le palier de quantité, puisqu\'elles restent sur une seule ligne. La répartition figure ensuite sur le bon à tirer, ce qui est le bon moment pour la relire avant que la presse chauffe.',
			),
			array(
				'q' => 'Est-ce fabriqué en France ?',
				'a' => 'L\'impression est faite en France, dans notre atelier. Nous écrivons « imprimé en France » et pas « fabriqué en France », parce que c\'est l\'impression qui est chez nous : le textile nu, lui, vient du catalogue d\'un fabricant.',
			),
		),
	),

	'page:associations' => array(
		'title'       => 'T-shirt personnalisé association : tailles, délai, minimum',
		'description' => 'T-shirts, polos et sweats personnalisés pour les associations : répartition des tailles, bon à tirer en ligne sans compte, impression comprise.',
		'h1'          => 'T-shirts, polos et sweats personnalisés pour les associations',
		'intro'       => array(
			'Une commande d’association tient rarement dans une seule taille. La répartition se saisit taille par taille, et toutes les tailles d’un même modèle comptent ensemble pour le palier de quantité.',
			'Trois familles se commandent directement, les t-shirts, les polos et les sweats, impression comprise dans le prix affiché. Le panier demande {MINIMUM_PIECES} pièces, toutes références confondues.',
			'Le bon à tirer se valide en ligne, sans créer de compte, et l’expédition part {DELAI_STANDARD} jours ouvrés après cette validation.',
		),
		'sections'    => array(
			array(
				'h2'         => 'Une seule commande, autant de tailles qu’il y a d’adhérents',
				'paragraphs' => array(
					'Le travail d’un trésorier n’est pas de choisir un t-shirt, c’est de rassembler une liste. Une liste de tailles qui bouge jusqu’à la clôture des inscriptions. La répartition se saisit ligne par ligne, une ligne par taille et la quantité en face.',
					'Découper la commande par taille ne coûte rien. La répartition d’un même modèle tient dans une seule ligne de panier, et c’est son total qui décide du palier de quantité, quelle que soit la part de chaque taille.',
					'Ce qui divise le palier, c’est de séparer la quantité en plusieurs lignes. Deux modèles différents, ou le même modèle ajouté deux fois au panier, gardent chacun leur propre quantité et donc chacun leur propre palier : les additionner ne fait pas baisser le prix unitaire. Regrouper la commande sur un seul modèle, en une seule fois, revient moins cher que la répartir sur trois.',
					'Le minimum, lui, se compte sur le panier entier : {MINIMUM_PIECES} pièces, toutes références confondues. Des t-shirts pour les bénévoles et des polos pour le bureau y comptent ensemble.',
				),
			),
			array(
				'h2'         => 'Le budget d’une association, et ce qui le fait baisser',
				'paragraphs' => array(
					'Un bureau compare des prix à la pièce, et l’argent est celui des adhérents. La grille complète est publiée sur chaque fiche produit : le prix unitaire à chaque palier de quantité, impression comprise. Vous chiffrez la commande et vous présentez un montant au bureau sans parler à personne.',
					'Il n’y a pas de tarif association séparé, et nous n’en inventerons pas un. Ce qui fait baisser le prix par pièce, c’est la quantité posée sur une même référence : les mêmes pièces commandées en deux fois, ou réparties sur deux modèles, tombent sur un palier plus bas ou égal.',
					'Le prix se calcule sur la surface d’encre réellement imprimée, pas sur le rectangle où le fichier a été déposé. Les marges transparentes d’un logo, le cas courant d’un fichier récupéré sur une clé USB, ne sont pas facturées.',
				),
			),
			array(
				'h2'         => 'Le fichier fourni par un bénévole',
				'paragraphs' => array(
					'Le logo d’une association existe rarement en fichier propre. Il vient d’une affiche, ou d’un export fait par quelqu’un qui a quitté le club. L’éditeur en ligne le pose sur le vêtement, en 2D, en 3D et en réalité augmentée, et le prix s’affiche avant l’ajout au panier.',
					'Vient ensuite la taille du marquage : jusqu’où peut-on agrandir le logo. Les zones d’impression sont publiées en centimètres sur chaque fiche produit, {ZONE_TSHIRT} pour un t-shirt en taille {TAILLE_MESUREE}, face avant. Vous connaissez la taille réelle du marquage avant de commander, et non au moment du bon à tirer.',
					'Ce bon à tirer se valide en ligne, sans créer de compte, et rien ne part en production avant cette validation.',
				),
				'links'      => array(
					array( 'label' => 'Préparer le fichier du logo', 'key' => 'page:fichiers-impression' ),
				),
			),
			array(
				'h2'         => 'La date du tournoi, et d’où part le compte à rebours',
				'paragraphs' => array(
					'La date d’un tournoi ne bouge pas. Le seul délai que nous publions est de {DELAI_STANDARD} jours ouvrés entre la validation du bon à tirer et l’expédition, et il ne part donc pas du jour de la commande.',
					'Nous ne proposons pas de délai plus court, parce que le travail que contient une commande n’y tiendrait pas. Les durées s’enchaînent, et une seule dépend de nous :',
				),
				'list'       => array(
					'la validation du bon à tirer, qui dépend de la réponse de votre bureau ;',
					'{DELAI_STANDARD} jours ouvrés de production, jusqu’à l’expédition ;',
					'l’acheminement Colissimo, que La Poste annonce à {DELAI_TRANSPORT} jours ouvrés en France métropolitaine.',
				),
				'after'      => array(
					'La durée qui glisse n’est pas la production, c’est l’aller-retour du bon à tirer : fixez la date de validation avant les inscriptions.',
				),
			),
			array(
				'h2'         => 'T-shirts, polos et sweats : ce que le catalogue contient',
				'paragraphs' => array(
					'Le catalogue publie {NB_REFERENCES} références sur ces trois familles, chacune dans ses tailles et ses coloris.',
					'Le grammage de chaque référence est publié et filtrable, ce qui sépare le t-shirt d’un tournoi de plein été du sweat qu’une association sportive porte au bord du terrain en novembre.',
					'Retrouver la couleur du club coince souvent, parce qu’un nom commercial ne dit pas la teinte. Le catalogue compte {NB_COLORIS} noms de coloris, regroupés en {NB_FAMILLES_COULEUR} familles de couleur mesurées sur le nuancier du fabricant et jamais devinées d’après le nom.',
				),
				'links'      => array(
					array( 'label' => 'Les commandes de club sportif', 'key' => 'page:clubs-sportifs' ),
				),
			),
			array(
				'h2'         => 'Ce qui se commande seul, et ce qui passe par un devis',
				'paragraphs' => array(
					'L’impression DTF est la seule technique commandable directement sur le site. C’est celle que l’éditeur affiche et celle qui est comprise dans le prix. Nous l’imprimons dans notre atelier, en France.',
					'La broderie, le flocage et la sublimation existent, et ils passent par un devis. La broderie est sous-traitée : elle n’est pas faite dans notre atelier, et nous n’annonçons aucun délai pour elle avant d’avoir la réponse de l’atelier qui la réalise. Le polo brodé de l’écusson suit donc ce chemin, et pas celui du panier.',
				),
				'links'      => array(
					array( 'label' => 'Demander un devis', 'key' => 'page:devis' ),
				),
			),
			array(
				'h2'         => 'Commencer par la liste, pas par le vêtement',
				'paragraphs' => array(
					'Rassemblez d’abord la répartition des tailles : c’est la quantité réunie sur un même modèle qui décide du palier, donc du prix unitaire. Ouvrez ensuite le rayon, posez le logo dans l’éditeur et lisez le prix avant l’ajout au panier.',
				),
				'links'      => array(
					array( 'label' => 'Les t-shirts du catalogue', 'key' => 'categorie:t-shirts' ),
					array( 'label' => 'Les polos du catalogue', 'key' => 'categorie:polos' ),
				),
			),
		),
		'faq'         => array(
			array(
				'q' => 'Quel est le minimum de commande pour une association ?',
				'a' => '{MINIMUM_PIECES} pièces, comptées sur le panier entier et non par taille ni par référence : des t-shirts, des polos et des sweats mélangés y comptent ensemble. En dessous, le panier refuse la validation.',
			),
			array(
				'q' => 'Peut-on mélanger des t-shirts et des polos dans la même commande ?',
				'a' => 'Oui, et les deux comptent ensemble pour le minimum de commande. Le palier de quantité, lui, se calcule par référence, sur la quantité réunie dans une même ligne de panier, toutes tailles confondues. À nombre de pièces égal, les concentrer sur un seul modèle coûte moins cher que les répartir sur plusieurs.',
			),
			array(
				'q' => 'Avez-vous un tarif association ?',
				'a' => 'Non, la même grille pour tout le monde, publiée sur chaque fiche produit, impression comprise. Elle baisse par palier de quantité, et rien d’autre ne la fait baisser.',
			),
			array(
				'q' => 'Combien de temps faut-il prévoir avant notre événement ?',
				'a' => '{DELAI_STANDARD} jours ouvrés entre la validation du bon à tirer et l’expédition, puis {DELAI_TRANSPORT} jours ouvrés d’acheminement Colissimo en France métropolitaine, soit {DELAI_TOTAL} jours ouvrés en tout. Nous ne publions pas de délai plus court, parce que nous ne le tiendrions pas.',
			),
			array(
				'q' => 'Notre logo a été fait par un bénévole, comment savoir ce qu’il donnera sur le vêtement ?',
				'a' => 'L’éditeur en ligne le pose sur le vêtement en 2D, en 3D et en réalité augmentée, avec la zone d’impression en centimètres ({ZONE_TSHIRT} pour un t-shirt en taille {TAILLE_MESUREE}, face avant). Rien ne part en production avant la validation du bon à tirer.',
			),
			array(
				'q' => 'Pouvez-vous broder les polos du bureau ?',
				'a' => 'Oui, par devis et non par le site. La broderie est sous-traitée, et nous n’annonçons pas de délai pour elle tant que l’atelier qui la réalise n’a pas répondu. Le flocage et la sublimation suivent le même chemin.',
			),
		),
	),

	'page:clubs-sportifs' => array(
		'title'       => 'Sweat et t-shirt personnalisés pour club de sport',
		'description' => 'Sweats, t-shirts et polos imprimés en France pour clubs sportifs. Zone d\'impression en cm, minimum {MINIMUM_PIECES} pièces.',
		'h1'          => 'Sweats, t-shirts et polos personnalisés pour clubs sportifs',
		'intro'       => array(
			'Nous imprimons des t-shirts, des polos et des sweats pour les clubs, en DTF, à partir de {MINIMUM_PIECES} pièces par commande.',
			'Nous ne vendons ni maillots techniques ni shorts : ces vêtements ne sont pas au catalogue.',
			'Le marquage est imprimé en France et les zones d\'impression sont publiées en centimètres sur chaque fiche produit.',
		),
		'sections'    => array(
			array(
				'h2'         => 'Ce que nous imprimons pour un club, et ce que nous ne vendons pas',
				'paragraphs' => array(
					'Le catalogue tient en t-shirts, polos et sweats, soit {NB_REFERENCES} références. Il n\'y a ni maillot de match, ni short, ni chaussette. Si vous équipez l\'équipe première pour jouer, ce n\'est pas ici, et autant le lire au premier paragraphe qu\'après avoir cherché dans le catalogue.',
				),
				'list'       => array(
					'Au catalogue : {NB_TSHIRTS} t-shirts, {NB_POLOS} polos, {NB_SWEATS} sweats.',
					'Pas au catalogue : maillot de match, short, chaussette, sac de sport.',
					'Commandable en ligne : le DTF. Sur devis : broderie, flocage, sublimation.',
				),
				'after'      => array(
					'Ce qui reste couvre le vestiaire et le bord du terrain : le sweat de l\'encadrement, le t-shirt d\'une journée de tournoi, le polo des dirigeants, la série vendue au profit du club. Le prix comprend l\'impression, et la grille complète par quantité est publiée sur chaque fiche produit.',
				),
				'links'      => array(
					array( 'label' => 'Les sweats du catalogue', 'key' => 'categorie:sweats' ),
				),
			),
			array(
				'h2'         => 'Une seule technique se commande en ligne, le DTF',
				'paragraphs' => array(
					'Vous déposez votre fichier, l\'éditeur montre le vêtement en 2D, en 3D et en réalité augmentée, et le prix s\'affiche avant l\'ajout au panier. Le bon à tirer se valide ensuite en ligne, sans créer de compte : le trésorier ou le président valide sans que personne ait à lui ouvrir un accès.',
					'Le flocage, la sublimation et la broderie existent, mais ils passent par un devis. La broderie est sous-traitée, elle ne sort pas de notre atelier, et nous n\'annonçons pas de délai pour elle.',
					'Le grammage de chaque référence est publié et filtrable. Un sweat que l\'on garde sur le dos au bord du terrain en février et un t-shirt de tournoi de juin ne se choisissent pas au même chiffre.',
				),
				'links'      => array(
					array( 'label' => 'Demander un devis broderie ou flocage', 'key' => 'page:devis' ),
				),
			),
			array(
				'h2'         => 'Le blason est facturé à l\'encre, pas au fichier',
				'paragraphs' => array(
					'Chaque fiche publie sa zone d\'impression en centimètres. Sur un t-shirt taille {TAILLE_MESUREE}, face avant, elle fait {ZONE_TSHIRT}. Vous savez si le blason y tient avant de commander, sans ouvrir l\'éditeur et sans nous écrire.',
					'Le marquage est calculé sur la surface d\'encre réellement imprimée, pas sur le rectangle dans lequel le fichier a été déposé. Un écusson rond enregistré au milieu d\'une grande image carrée est facturé sur l\'écusson : les marges transparentes ne comptent pas. Cela change le prix quand le logo du club vous arrive d\'un bénévole, avec beaucoup de vide autour du dessin.',
				),
				'links'      => array(
					array( 'label' => 'Préparer le fichier du blason', 'key' => 'page:fichiers-impression' ),
				),
			),
			array(
				'h2'         => 'Retrouver la couleur du club',
				'paragraphs' => array(
					'Un coloris arrive avec un nom, et un nom n\'est pas une couleur. Nous mesurons donc chaque coloris sur le nuancier du fabricant, jamais d\'après son nom : {NB_COLORIS} noms rangés en {NB_FAMILLES_COULEUR} familles mesurées. Deux bleus dont les noms se ressemblent restent des coloris distincts, et vous filtrez sur la famille pour les comparer côte à côte.',
					'Ce que la mesure ne fait pas, dit d\'avance : elle est prise sur le nuancier du fabricant et non sur le tissu que vous recevrez, et un écran n\'est pas un vêtement. En revanche le nom du coloris figure sur votre commande, et c\'est lui que vous reprenez pour retrouver le même bleu, quand la personne qui avait passé la première commande n\'est plus au bureau.',
				),
			),
			array(
				'h2'         => 'Le budget, écrit avant la saison',
				'paragraphs' => array(
					'Le prix baisse par palier de quantité, et le palier se calcule ligne par ligne, sur la quantité d\'une même référence. Vingt sweats et dix t-shirts dans le même panier ne comptent pas comme trente pièces : la remise regarde vingt d\'un côté, dix de l\'autre, et jamais le total du panier.',
					'Le conseil d\'achat qui en découle : regrouper la quantité sur une même référence coûte moins cher que la répartir sur plusieurs modèles. Si l\'encadrement et les dirigeants peuvent porter le même sweat avec le même marquage, les deux quantités s\'ajoutent sur une seule ligne et peuvent passer un palier ; sur trois modèles différents, chacun reste seul dans la grille. Et sur une même référence, une commande groupée avant l\'assemblée ne coûte jamais plus cher que la même quantité étalée sur l\'année, le plus souvent moins.',
				),
				'list'       => array(
					'Le palier de quantité se compte ligne par ligne, sur une même référence portant le même marquage.',
					'Le minimum de commande se compte sur le panier entier : {MINIMUM_PIECES} pièces, toutes références confondues.',
					'Au-delà de {SEUIL_DEVIS} pièces sur une même référence, la commande passe par un devis et non par le panier.',
				),
				'after'      => array(
					'Les deux règles vont donc dans des sens opposés : additionner des modèles différents vous fait atteindre le minimum, jamais le palier.',
					'Une conséquence pratique : saisissez la quantité en une fois. Deux ajouts successifs du même sweat font deux lignes de panier, chacune avec son propre palier. Si cela vous arrive, reportez la quantité sur une seule ligne depuis le panier plutôt que d\'en garder deux.',
					'La répartition des tailles se saisit ligne par ligne : vous entrez ce que chaque taille représente, vous n\'achetez pas un lot tout fait. Le chiffre que vous portez au vote est celui de la grille publiée sur la fiche, et c\'est celui que vous retrouvez au panier, la livraison en plus.',
				),
				'links'      => array(
					array( 'label' => 'Les commandes d\'association', 'key' => 'page:associations' ),
				),
			),
			array(
				'h2'         => 'Le réassort quand un joueur arrive en novembre',
				'paragraphs' => array(
					'Le minimum de {MINIMUM_PIECES} pièces s\'applique aussi au réassort. Nous ne pouvons pas imprimer un sweat seul en cours de saison, et c\'est la contrainte la plus gênante pour un club qui recrute toute l\'année.',
					'Elle se règle en septembre plutôt qu\'en novembre : ajoutez quelques pièces d\'avance à la commande de début de saison, sur la même référence et le même marquage. Elles montent la quantité de cette ligne et prennent donc son palier, alors qu\'un réassort reparti seul en novembre repart à la première colonne de la grille. Ces pièces d\'avance ne dorment pas au placard : c\'est le sweat de l\'arrivant de novembre.',
				),
				'links'      => array(
					array( 'label' => 'Les petites séries', 'key' => 'page:petites-series' ),
				),
			),
			array(
				'h2'         => 'Le délai part de votre bon à tirer',
				'paragraphs' => array(
					'{DELAI_STANDARD} jours ouvrés entre la validation du bon à tirer et l\'expédition. Le compte ne démarre pas à la commande, il démarre quand vous avez validé. Un bon à tirer qui attend la prochaine réunion de bureau décale la date d\'autant, et c\'est la seule partie du délai qui vous appartient.',
					'Nous ne vendons pas de délai plus court. Le travail que contient une commande a été mesuré, une promesse plus courte ne tiendrait pas, donc nous ne la publions pas. La livraison se fait ensuite en Colissimo, France métropolitaine.',
				),
			),
		),
		'faq'         => array(
			array(
				'q' => 'Vendez-vous des maillots de match, des shorts ou des chaussettes ?',
				'a' => 'Non. Le catalogue tient en t-shirts, polos et sweats, soit {NB_REFERENCES} références. Un maillot technique et un short ne sont pas des vêtements que nous imprimons, et vous ne les trouverez pas en cherchant sur le site.',
			),
			array(
				'q' => 'Quel est le minimum de commande ?',
				'a' => '{MINIMUM_PIECES} pièces, comptées sur le panier entier, toutes références confondues : des t-shirts et des sweats commandés ensemble comptent ensemble. Le minimum s\'applique aussi à un réassort en cours de saison.',
			),
			array(
				'q' => 'Le prix baisse-t-il si j\'additionne les sweats et les t-shirts ?',
				'a' => 'Non. Le palier de quantité se calcule sur la quantité d\'une même référence, ligne par ligne : vingt sweats et dix t-shirts ne comptent pas comme trente pièces, la remise regarde vingt d\'un côté et dix de l\'autre. Ce qui se compte sur le panier entier, c\'est le minimum de commande. Regrouper la quantité sur une même référence coûte donc moins cher que la répartir sur plusieurs modèles.',
			),
			array(
				'q' => 'Le blason du club tient-il sur le devant d\'un t-shirt ?',
				'a' => 'La zone est publiée sur chaque fiche, en centimètres. Sur un t-shirt taille {TAILLE_MESUREE}, face avant, elle fait {ZONE_TSHIRT}. Le marquage étant facturé sur la surface d\'encre, les marges transparentes autour de l\'écusson ne sont pas comptées.',
			),
			array(
				'q' => 'Quel est le délai, et à partir de quand se compte-t-il ?',
				'a' => '{DELAI_STANDARD} jours ouvrés entre la validation du bon à tirer et l\'expédition, puis la livraison en Colissimo, France métropolitaine. Il n\'existe pas d\'option plus courte : nous ne publions que le délai que nous tenons.',
			),
			array(
				'q' => 'Faites-vous la broderie du blason ?',
				'a' => 'Elle passe par un devis et elle est sous-traitée : elle n\'est pas réalisée dans notre atelier. Nous n\'annonçons pas de délai pour elle, pour la même raison.',
			),
			array(
				'q' => 'Comment être sûr de la couleur du club ?',
				'a' => 'Chaque coloris est mesuré sur le nuancier du fabricant et jamais déduit de son nom : {NB_COLORIS} noms rangés en {NB_FAMILLES_COULEUR} familles mesurées. Vous filtrez sur la famille, vous comparez les candidats, et le nom du coloris figure sur votre commande pour retrouver le même plus tard. La mesure porte sur le nuancier, pas sur le tissu livré.',
			),
		),
	),

	'page:evenementiel' => array(
		'title'       => 'T-shirt personnalisé événement : calculez votre date',
		'description' => '{DELAI_STANDARD} jours ouvrés après validation du bon à tirer, plus le transport. Calculez vous-même votre date limite de commande.',
		'h1'          => 'T-shirts personnalisés pour un événement : commencez par la date',
		'intro'       => array(
			'Notre délai est de {DELAI_STANDARD} jours ouvrés entre la validation de votre bon à tirer et l\'expédition, et il faut compter le transport en plus.',
			'Une commande part de {MINIMUM_PIECES} pièces, comptées sur le panier entier.',
			'Cette page sert à faire le calcul vous-même avant de commander, y compris quand il donne non.',
		),
		'sections'    => array(
			array(
				'h2'         => 'Calculez votre date limite de commande',
				'paragraphs' => array(
					'Le délai commence le jour où vous validez le bon à tirer, pas le jour où vous passez commande. Entre les deux il y a l\'épreuve que nous préparons et le temps que vous prenez pour la relire. Ce temps-là ne se déduit pas des {DELAI_STANDARD} jours ouvrés, il s\'y ajoute.',
					'Prenez la date de votre événement et remontez le calendrier à rebours.',
				),
				'list'       => array(
					'Le jour où vous voulez les vêtements en main. Ce n\'est pas le jour de l\'événement : un carton qui arrive le matin même ne laisse aucune reprise possible.',
					'Le transport. Nous expédions en Colissimo, France métropolitaine, et La Poste annonce {DELAI_TRANSPORT} jours ouvrés. C\'est son chiffre et non le nôtre : une fois le colis remis, la date ne dépend plus de nous.',
					'{DELAI_STANDARD} jours ouvrés d\'atelier. Ouvrés veut dire du lundi au vendredi, hors jours fériés : un jour férié dans l\'intervalle décale l\'expédition d\'autant.',
					'Le temps du bon à tirer : le vôtre pour le relire, et celui de la personne qui doit l\'approuver si ce n\'est pas vous.',
					'Ce qu\'il reste est votre date limite de commande. Si elle est derrière vous, la réponse est non.',
				),
				'after'      => array(
					'Une seule de ces durées est la nôtre. C\'est aussi la seule sur laquelle nous nous engageons.',
				),
			),
			array(
				'h2'         => 'Le bon à tirer décide du départ',
				'paragraphs' => array(
					'Vous commandez, nous préparons le bon à tirer, vous le validez en ligne, sans créer de compte. Rien ne part en production avant cette validation, et les {DELAI_STANDARD} jours ouvrés démarrent à ce moment-là.',
					'C\'est la partie du calendrier que vous tenez entièrement. Chaque jour d\'attente sur un bon à tirer non validé décale l\'expédition d\'un jour. Quand la personne qui valide n\'est pas celle qui commande, un président d\'association ou un responsable de site, prévenez-la avant l\'envoi et pas le jour où le message arrive dans sa boîte.',
				),
			),
			array(
				'h2'         => 'Le délai ne se raccourcit pas',
				'paragraphs' => array(
					'Aucun supplément ne raccourcit la fabrication. Le seul délai publié sur ce site est {DELAI_STANDARD} jours ouvrés après validation du bon à tirer, transport en plus.',
					'Une date que l\'atelier ne tient pas, ce sont des t-shirts livrés le lendemain du salon. Si votre calcul tombe après votre date, ne commandez pas. Écrivez-nous la date, la quantité et le vêtement avant de payer, nous vérifierons le calcul avec vous.',
				),
			),
			array(
				'h2'         => 'La quantité et la répartition des tailles',
				'paragraphs' => array(
					'La commande commence à {MINIMUM_PIECES} pièces. Elles se comptent sur le panier entier et non sur une ligne : vous pouvez les répartir sur plusieurs modèles, plusieurs coloris et plusieurs tailles, il faut seulement que le total soit atteint à la validation du panier.',
					'Le palier de quantité, lui, ne se compte pas de la même façon : il s\'applique ligne par ligne, sur la quantité d\'une même référence. Des t-shirts et des polos ajoutés au même panier ne s\'additionnent donc pas pour faire baisser le prix unitaire : chaque ligne obtient le palier de sa propre quantité. Les tailles d\'une même ligne, elles, comptent ensemble, puisqu\'une ligne répartie du S au XXL reste une seule ligne à sa quantité totale.',
					'Pour un événement, cela donne un conseil d\'achat clair : un même modèle pour tout le monde, décliné en tailles et en coloris, revient moins cher que le même nombre de pièces éclaté sur trois modèles différents.',
					'La répartition des tailles se saisit ligne par ligne, au moment de la commande. Pour un événement, cela veut dire faire circuler la liste des inscrits avant et non pendant : ce temps de collecte s\'ajoute au délai.',
					'Commandez la totalité en une seule fois, pièces de réserve comprises. Un complément commandé après coup est une nouvelle commande, avec son propre bon à tirer et les mêmes {DELAI_STANDARD} jours ouvrés à partir de sa validation : refaites le calcul avant de compter dessus.',
					'Au-delà de {SEUIL_DEVIS} pièces sur une même ligne, la boutique ne chiffre plus seule et la commande passe par un devis ; une commande d\'un montant important y bascule également. Le devis ajoute une étape avant le bon à tirer et nous n\'annonçons pas de délai pour cette étape, donc demandez-le avant de bâtir votre calendrier.',
				),
				'links'      => array(
					array( 'label' => 'Commander en petite série', 'key' => 'page:petites-series' ),
					array( 'label' => 'Demander un devis pour une grande quantité', 'key' => 'page:devis' ),
				),
			),
			array(
				'h2'         => 'Choisir le vêtement : grammage et coloris',
				'paragraphs' => array(
					'Trois familles au catalogue, t-shirts, polos et sweats, pour {NB_REFERENCES} références.',
					'Le grammage de chaque référence est publié et filtrable. C\'est le chiffre qui sépare un t-shirt léger d\'un t-shirt épais, et il ne se devine pas sur une photo de fiche produit.',
					'{NB_COLORIS} noms de coloris sont regroupés en {NB_FAMILLES_COULEUR} familles de couleur mesurées sur le nuancier du fabricant, jamais déduites du nom commercial. Filtrer sur les bleus vous rend donc les bleus, y compris ceux que le fabricant a baptisés autrement.',
				),
				'links'      => array(
					array( 'label' => 'Les t-shirts du catalogue', 'key' => 'categorie:t-shirts' ),
					array( 'label' => 'Les polos du catalogue', 'key' => 'categorie:polos' ),
				),
			),
			array(
				'h2'         => 'Ce que le prix mesure',
				'paragraphs' => array(
					'Le prix comprend l\'impression. Il baisse par palier de quantité, sur la quantité d\'une même ligne, et la grille complète des paliers est publiée sur chaque fiche produit, avant que vous ayez rempli quoi que ce soit.',
					'Il est calculé sur la surface d\'encre réellement imprimée, pas sur le rectangle du fichier que vous déposez. Un logo étroit exporté au milieu d\'un grand fichier transparent est facturé sur son encre, pas sur les marges vides qui l\'entourent.',
					'Les zones d\'impression sont publiées en centimètres sur chaque fiche produit : {ZONE_TSHIRT} pour un t-shirt en taille {TAILLE_MESUREE}, face avant. Vous pouvez donc vérifier que le logo de votre association tient dans la zone avant de commander, au lieu de le découvrir sur le bon à tirer.',
					'L\'éditeur en ligne montre le vêtement en 2D, en 3D et en réalité augmentée, et le prix s\'affiche avant l\'ajout au panier. Un trésorier qui doit faire approuver une dépense a donc l\'image et le montant sur le même écran.',
				),
				'links'      => array(
					array( 'label' => 'Préparer un fichier imprimable', 'key' => 'page:fichiers-impression' ),
				),
			),
			array(
				'h2'         => 'Le DTF en ligne, la broderie en devis',
				'paragraphs' => array(
					'La seule technique que vous pouvez commander seul sur ce site est le DTF, imprimé en France, dans notre atelier. Les {DELAI_STANDARD} jours ouvrés sont ceux de cet atelier.',
					'La broderie, le flocage et la sublimation existent, mais passent par un devis. La broderie est sous-traitée : elle ne sort pas de notre atelier, et nous n\'annonçons aucun délai pour elle. Si votre projet en contient, le calcul de date de cette page ne s\'y applique pas.',
				),
			),
		),
		'faq'         => array(
			array(
				'q' => 'Comment savoir si ma date est encore tenable ?',
				'a' => 'Comptez {DELAI_STANDARD} jours ouvrés à partir du jour où vous validerez le bon à tirer, ajoutez le délai que le transporteur annonce pour votre adresse, puis comparez au jour où vous voulez les vêtements en main. Si vous tombez après, c\'est non, et il vaut mieux le savoir avant de payer.',
			),
			array(
				'q' => 'Le délai part de ma commande ou de la validation du bon à tirer ?',
				'a' => 'De la validation. Vous commandez, nous préparons l\'épreuve, vous la validez en ligne sans créer de compte, et les {DELAI_STANDARD} jours ouvrés commencent là. Rien n\'est imprimé avant.',
			),
			array(
				'q' => 'Peut-on aller plus vite en payant un supplément ?',
				'a' => 'Non. Aucune ligne de tarif ne raccourcit la fabrication. Le seul délai publié est {DELAI_STANDARD} jours ouvrés après validation du bon à tirer, transport en plus.',
			),
			array(
				'q' => 'Nous n\'avons pas encore la répartition des tailles de l\'équipe.',
				'a' => 'Elle se saisit ligne par ligne au moment de la commande, donc collectez-la avant. Ce temps s\'ajoute au délai au lieu de s\'en déduire, puisque les {DELAI_STANDARD} jours ouvrés ne partent qu\'à la validation du bon à tirer.',
			),
			array(
				'q' => 'Peut-on commander moins de {MINIMUM_PIECES} pièces ?',
				'a' => 'Non. Le panier commence à {MINIMUM_PIECES} pièces, toutes lignes confondues. Ces pièces peuvent être réparties sur plusieurs modèles, plusieurs coloris et plusieurs tailles.',
			),
			array(
				'q' => 'Nos t-shirts et nos polos s\'additionnent-ils pour faire baisser le prix ?',
				'a' => 'Non. Le minimum de commande se compte sur le panier entier, mais le palier de quantité se calcule ligne par ligne, sur la quantité d\'une même référence. Regrouper la quantité sur un seul modèle coûte donc moins cher que la répartir sur trois.',
			),
			array(
				'q' => 'Nous voulons de la broderie sur les polos de l\'accueil.',
				'a' => 'Cela passe par un devis. La broderie est sous-traitée et nous n\'annonçons pas de délai pour elle, donc le calcul de date de cette page ne couvre pas ce cas. Le DTF est la seule technique commandable seul en ligne.',
			),
		),
	),

	'page:restauration' => array(
		'title'       => 'Tenue de service personnalisée : restaurant, bar, hôtel',
		'description' => 'Polos, t-shirts et sweats personnalisés, salle et bar, sans tenue de cuisine. Imprimé en France, minimum {MINIMUM_PIECES} pièces.',
		'h1'          => 'Tenue de service personnalisée pour restaurants, cafés, bars et hôtels',
		'intro'       => array(
			'Nous imprimons des polos, des t-shirts et des sweats pour les équipes en salle et au bar. Une commande part de {MINIMUM_PIECES} pièces, comptées sur le panier entier.',
			'Nous ne faisons pas la tenue de cuisine : ni veste, ni tablier, ni toque. Ces vêtements ne sont pas au catalogue.',
			'Le marquage est imprimé en France, et les dimensions d\'impression sont publiées en centimètres sur chaque fiche produit.',
		),
		'sections'    => array(
			array(
				'h2'         => 'Ce que nous imprimons, et ce que nous n\'imprimons pas',
				'paragraphs' => array(
					'Le catalogue tient en t-shirts, polos et sweats. Ce que nous n\'imprimons pas figure dans la même liste, pour que vous le lisiez maintenant et non au moment de valider le panier.',
				),
				'list'       => array(
					'Au catalogue : {NB_REFERENCES} références, dont {NB_POLOS} polos, {NB_TSHIRTS} t-shirts et {NB_SWEATS} sweats.',
					'Pas au catalogue : veste de cuisine, tablier, toque, casquette, chemise de salle.',
					'Commandable en ligne : le DTF. Par devis : broderie, flocage, sublimation.',
				),
				'after'      => array(
					'Ce qui reste couvre la salle et le bar, c\'est-à-dire les vêtements que vos clients voient. Le grammage de chaque référence est publié et filtrable : vous choisissez le poids de la maille avant de commander, au lieu de le découvrir en ouvrant le carton.',
				),
				'links'      => array(
					array( 'label' => 'Voir les polos au catalogue', 'key' => 'categorie:polos' ),
					array( 'label' => 'Voir les sweats au catalogue', 'key' => 'categorie:sweats' ),
				),
			),
			array(
				'h2'         => 'Le réassort, quand un serveur part et qu\'un autre arrive',
				'paragraphs' => array(
					'En salle, le sujet n\'est pas la première commande, c\'est la deuxième. Une équipe habillée le même jour se dépareille au premier départ, et le remplaçant hérite d\'un polo racheté de mémoire, dans un bleu qui n\'est pas tout à fait le bleu des autres.',
					'Les {NB_COLORIS} noms de coloris sont publiés tels que le fabricant les écrit, et rangés en {NB_FAMILLES_COULEUR} familles de couleur : la famille affichée vient de la mesure du nuancier du fabricant, pas de l\'étiquette, et le filtre suit cette mesure. Pour recommander à l\'identique, ce sont la référence et ce nom de coloris qu\'il faut avoir notés.',
					'Un réassort repasse par le même minimum que la première commande, en pièces comme en montant. Et comme le palier de quantité se calcule sur la quantité d\'une même référence, quelques pièces d\'avance commandées avec la série entrent dans le palier de la série ; commandées plus tard, elles repartent d\'une quantité plus faible et donc d\'une remise plus faible. Nous ne promettons pas non plus qu\'une référence restera au catalogue du fabricant, ce qui est une deuxième raison de prendre cette avance tout de suite.',
				),
			),
			array(
				'h2'         => 'La répartition des tailles se saisit ligne par ligne',
				'paragraphs' => array(
					'Une brigade de salle ne se commande pas en une taille unique. La répartition se saisit ligne par ligne, une taille et une quantité par ligne, sans fichier à joindre ni tableau à recopier dans un e-mail.',
					'Mélanger les tailles ne fait pas perdre le palier : les quantités saisies s\'additionnent en une seule ligne de panier, et c\'est cette quantité-là qui fixe le palier. Mélanger les modèles, en revanche, ne les additionne pas. Le palier de quantité se calcule référence par référence : des polos et des sweats commandés ensemble gardent chacun le leur, et la même quantité regroupée sur une seule référence revient moins cher qu\'éclatée sur trois modèles.',
					'Ce qui se compte bien sur le panier entier, c\'est le minimum de commande : {MINIMUM_PIECES} pièces, toutes tailles et toutes références confondues. La grille complète des paliers est publiée sur chaque fiche produit, avant que vous ayez rempli quoi que ce soit.',
				),
			),
			array(
				'h2'         => 'Le prix, et ce qu\'il contient',
				'paragraphs' => array(
					'Le prix comprend l\'impression, et il s\'affiche avant l\'ajout au panier. Vous n\'avez pas à demander un devis pour savoir ce que coûte un polo marqué sur la poitrine gauche.',
					'Le marquage est calculé sur la surface d\'encre réellement imprimée, pas sur le rectangle dans lequel le fichier a été déposé. Un logo exporté avec de larges marges transparentes coûte la même chose qu\'un logo détouré au plus près : c\'est l\'encre posée sur le vêtement qui est mesurée, et c\'est la même mesure qui part en production.',
					'La commande commence à {MINIMUM_PIECES} pièces sur le panier entier : nous ne vendons pas à l\'unité, et c\'est écrit ici plutôt qu\'à l\'étape du paiement.',
				),
				'links'      => array(
					array( 'label' => 'Commander en petite série', 'key' => 'page:petites-series' ),
				),
			),
			array(
				'h2'         => 'Les dimensions d\'impression sont publiées en centimètres',
				'paragraphs' => array(
					'Sur un t-shirt en taille {TAILLE_MESUREE}, la zone imprimable de la face avant mesure {ZONE_TSHIRT}. Chaque fiche produit publie les siennes. Une zone annoncée en format de papier ne vous dit ni où le visuel tombe sous le col, ni jusqu\'où il descend sur la poitrine.',
					'L\'éditeur en ligne montre le vêtement en 2D, en 3D et en réalité augmentée avant la commande, avec le prix affiché avant l\'ajout au panier. Le logo d\'un bar posé trop haut sur un polo se voit à l\'écran, pas à la livraison. Ce que vous placez à l\'écran est ce qui est mesuré pour le prix, et c\'est ce qui part en production.',
				),
				'links'      => array(
					array( 'label' => 'Préparer votre fichier avant de commander', 'key' => 'page:fichiers-impression' ),
				),
			),
			array(
				'h2'         => 'Le bon à tirer, puis {DELAI_STANDARD} jours ouvrés',
				'paragraphs' => array(
					'Le bon à tirer se valide en ligne, sans créer de compte. Tant qu\'il n\'est pas validé, rien n\'est imprimé.',
					'À partir de cette validation, comptez {DELAI_STANDARD} jours ouvrés avant l\'expédition, puis {DELAI_TRANSPORT} jours ouvrés d\'acheminement Colissimo, soit {DELAI_TOTAL} jours ouvrés en tout. Les {DELAI_TRANSPORT} jours sont ceux que La Poste annonce pour la France métropolitaine, et c\'est la seule partie du calendrier qui ne dépend ni de vous ni de nous.',
					'Il n\'y a ni express ni urgence sur ce site. Si vous avez une date à tenir, remontez le calendrier à partir d\'elle : {DELAI_STANDARD} jours ouvrés après la validation du bon à tirer, plus l\'acheminement, plus le temps qu\'il vous faudra pour valider. Nous n\'affichons pas de délai plus court contre supplément, parce que nous ne le tiendrions pas.',
				),
			),
			array(
				'h2'         => 'Broderie, flocage et sublimation passent par un devis',
				'paragraphs' => array(
					'Le DTF est la seule technique commandable en autonomie sur le site : c\'est celle dont les zones, les paliers de prix et le délai sont publiés ici.',
					'La broderie, le flocage et la sublimation existent, mais par devis. La broderie est sous-traitée, elle ne sort pas de notre atelier, et nous n\'annonçons aucun délai pour elle tant que l\'atelier qui la réalise ne l\'a pas confirmé. Pour un écusson brodé sur un polo de réception d\'hôtel, la réponse est un devis, pas un ajout au panier.',
				),
				'links'      => array(
					array( 'label' => 'Demander un devis pour la broderie', 'key' => 'page:devis' ),
				),
			),
		),
		'faq'         => array(
			array(
				'q' => 'Faites-vous les vestes de cuisine, les tabliers et les toques ?',
				'a' => 'Non. Le catalogue tient en t-shirts, polos et sweats, soit {NB_REFERENCES} références. Pour la cuisine, il vous faudra un autre fournisseur. Pour la salle et le bar, nous imprimons les polos, les t-shirts et les sweats.',
			),
			array(
				'q' => 'Quel est le minimum de commande ?',
				'a' => '{MINIMUM_PIECES} pièces, toutes tailles et toutes références confondues : des polos et des sweats sur la même commande comptent ensemble pour le minimum. Nous ne vendons pas à l\'unité.',
			),
			array(
				'q' => 'Commander plusieurs modèles à la fois fait-il baisser le prix unitaire ?',
				'a' => 'Non, pas comme on l\'imagine souvent. Le palier de quantité se calcule sur la quantité d\'une même référence : regrouper la quantité sur un seul modèle revient moins cher que la répartir sur trois. Les tailles, elles, s\'additionnent : une même référence en plusieurs tailles reste une seule ligne de panier. Ce qui se compte sur le panier entier, c\'est le minimum de commande.',
			),
			array(
				'q' => 'Sous quel délai la commande est-elle expédiée ?',
				'a' => '{DELAI_STANDARD} jours ouvrés entre la validation du bon à tirer et l\'expédition, puis {DELAI_TRANSPORT} jours ouvrés d\'acheminement Colissimo : {DELAI_TOTAL} jours ouvrés en tout. Le compte à rebours part de votre validation du bon à tirer, pas de la commande. Il n\'y a ni express ni urgence, donc une ouverture se prépare en remontant le calendrier.',
			),
			array(
				'q' => 'Pourrons-nous recommander exactement le même polo à la saison suivante ?',
				'a' => 'Tant que le fabricant garde la référence à son catalogue, oui. Le coloris est publié sous le nom du fabricant : c\'est ce nom, avec la référence, qu\'il faut ressaisir à l\'identique. Le réassort repasse par le minimum de commande, en pièces comme en montant.',
			),
			array(
				'q' => 'Combien de lavages tient l\'impression ?',
				'a' => 'Nous ne publions pas de nombre de lavages. Nous ne l\'avons pas mesuré sur nos vêtements, et nous ne reprenons pas le chiffre d\'un fournisseur de film comme s\'il était le nôtre. Ce que nous publions par référence, c\'est le grammage, filtrable au catalogue. Le jour où la mesure existera, le nombre sera écrit ici.',
			),
			array(
				'q' => 'Le logo est-il facturé sur sa taille réelle ou sur celle du fichier ?',
				'a' => 'Sur l\'encre réellement imprimée. Les marges transparentes autour d\'un logo ne sont pas facturées, et un fichier exporté large ne coûte pas plus cher qu\'un fichier détouré. La surface qui sert au prix est celle qui part en production.',
			),
		),
	),

	'page:petites-series' => array(
		'title'       => 'Textile personnalisé en petite série et petite quantité',
		'description' => 'T-shirts, polos et sweats imprimés en France à partir de {MINIMUM_PIECES} pièces. Prix impression comprise, zones publiées en centimètres.',
		'h1'          => 'Petites séries : t-shirts, polos et sweats personnalisés',
		'intro'       => array(
			'Nous imprimons à partir de {MINIMUM_PIECES} pièces, et le panier refuse en dessous. Ce n’est pas une politique commerciale : un transfert DTF s’imprime sur un film vendu au mètre linéaire, dont le fournisseur facture un métrage minimum, et la presse se règle une fois pour toute la série. Sous {MINIMUM_PIECES} pièces, cette mise en route pèse plus que les vêtements qu’elle marque.',
			'Le minimum porte sur la commande entière : des t-shirts et des sweats dans le même panier comptent ensemble pour l’atteindre. La remise de quantité, elle, se calcule référence par référence, sur la quantité d’un même modèle. Regrouper les pièces sur un seul modèle donne donc un prix unitaire plus bas que de les répartir sur plusieurs.',
			'Le panier contrôle un seul seuil au moment de valider : {MINIMUM_PIECES} pièces. Il dit combien il en manque, plutôt que de vous renvoyer une règle.',
		),
		'sections'    => array(
			array(
				'h2'         => 'Ce qu’une série coûte avant le premier vêtement',
				'paragraphs' => array(
					'Un transfert DTF ne coûte pas seulement à la pièce. Trois postes ne bougent pas quand la quantité bouge, et une commande qui n’atteint pas le métrage minimum du fournisseur paie du film qu’elle n’utilise pas.',
				),
				'list'       => array(
					'Le film DTF, vendu au mètre linéaire, avec un métrage minimum facturé par le fournisseur.',
					'Le bon à tirer, préparé et vérifié une fois pour toute la série.',
					'Le réglage de la presse, fait une fois, quel que soit le nombre de pièces à passer.',
				),
				'after'      => array(
					'C’est aussi pourquoi vous ne verrez pas de forfait de mise en route sur votre facture. Il est déjà dans le prix unitaire, et c’est précisément ce qu’on ne peut plus étaler en dessous de {MINIMUM_PIECES} pièces.',
				),
			),
			array(
				'h2'         => 'Plusieurs tailles dans une même commande',
				'paragraphs' => array(
					'{MINIMUM_PIECES} pièces, oui, mais réparties sur autant de tailles qu’il y a de personnes à habiller. La fiche produit a un mode « plusieurs tailles » pour cela, et la saisie se fait ligne par ligne.',
				),
				'list'       => array(
					'Choisissez le mode « plusieurs tailles » sur la fiche produit.',
					'Saisissez le nombre de pièces par taille.',
					'Le total des lignes doit atteindre {MINIMUM_PIECES} pièces.',
				),
				'after'      => array(
					'Le prix unitaire ne dépend pas de la répartition. Il se calcule sur le vêtement, la quantité de la ligne et la surface d’encre, jamais sur la taille commandée : la même commande répartie sur plusieurs tailles ou concentrée sur une seule donne le même total.',
					'Les tailles d’un même modèle forment une seule ligne de commande, et c’est leur total qui décide du palier de quantité. Détailler les tailles ne coupe donc pas la remise en morceaux, contrairement à un panier composé de plusieurs modèles.',
					'Le visuel, lui, est gradué avec le vêtement par défaut : il grandit avec la taille au lieu d’être posé à l’identique sur toutes. La zone d’impression publiée est mesurée en taille {TAILLE_MESUREE}.',
				),
				'links'      => array(
					array( 'label' => 'Commander pour un club sportif', 'key' => 'page:clubs-sportifs' ),
				),
			),
			array(
				'h2'         => 'Ce que le prix comprend',
				'paragraphs' => array(
					'Le prix affiché comprend l’impression. Pas de frais de marquage ajouté au panier, pas de frais de fichier.',
					'Le tarif baisse par palier de quantité, et le palier se compte sur une même référence. Des t-shirts et des sweats dans le même panier ne s’additionnent pas pour faire baisser le prix unitaire : chaque ligne est tarifée sur sa propre quantité. Le minimum de commande, lui, se compte bien sur le panier entier : c’est le seul des deux qui additionne des références différentes.',
					'La grille est publiée sur chaque fiche produit et pas dans une page d’aide. Chaque ligne est une quantité à laquelle le tarif change, la première étant le minimum : le palier suivant se lit avant de commander, avec le nombre de pièces d’un même modèle qu’il demande.',
					'La surface facturée est celle de l’encre, pas celle du fichier. Un logo déposé au milieu d’un grand PNG vide coûte le logo : les marges transparentes ne sont pas comptées.',
				),
				'links'      => array(
					array( 'label' => 'Préparer un fichier prêt à imprimer', 'key' => 'page:fichiers-impression' ),
				),
			),
			array(
				'h2'         => 'Les dimensions d’impression, en centimètres',
				'paragraphs' => array(
					'Sur un t-shirt en taille {TAILLE_MESUREE}, la face avant accepte {ZONE_TSHIRT}. Le chiffre est sur chaque fiche produit, avec un dessin à l’échelle et une feuille A4 posée à côté, à la même échelle.',
					'Savoir si le logo tient : vous avez la réponse sur la fiche, avant de commander, sans ouvrir d’éditeur et sans attendre un devis.',
					'L’éditeur en ligne montre ensuite votre visuel à l’échelle sur le vêtement, en 2D, en 3D et en réalité augmentée, et le prix s’affiche avant l’ajout au panier.',
				),
			),
			array(
				'h2'         => 'Le délai, du bon à tirer à l’expédition',
				'paragraphs' => array(
					'{DELAI_STANDARD} jours ouvrés entre la validation de votre bon à tirer et l’expédition. Le compte part de votre validation, pas de votre commande : tant que le bon à tirer n’est pas validé, rien n’est imprimé.',
					'Nous ne publions pas de délai plus court. Le travail entre un bon à tirer validé et un colis prêt a été mesuré, et il n’y rentre pas. Annoncer une date que la presse ne tiendrait pas serait une pratique commerciale trompeuse, et sur une commande calée sur une date, la date est la seule chose qui compte.',
					'Livraison Colissimo, France métropolitaine. Le bon à tirer se valide en ligne, sans créer de compte.',
				),
			),
			array(
				'h2'         => 'Ce que nous imprimons, et ce qui passe par un devis',
				'paragraphs' => array(
					'En autonomie sur le site, une seule technique : le DTF. Un transfert imprimé sur film, puis pressé sur le vêtement. Il ne demande pas un écran par couleur, et c’est exactement ce qui rend une petite série possible : il n’y a pas d’outillage à amortir sur une longue série.',
					'La broderie, le flocage et la sublimation passent par un devis. La broderie est sous-traitée : elle n’est pas faite dans notre atelier, et nous ne vous annoncerons pas de délai pour elle tant qu’il ne dépend pas de nous.',
				),
				'links'      => array(
					array( 'label' => 'Demander un devis', 'key' => 'page:devis' ),
				),
			),
			array(
				'h2'         => 'Le choix ne rétrécit pas avec la quantité',
				'paragraphs' => array(
					'{NB_REFERENCES} références au catalogue, en t-shirts, en polos et en sweats, et le marquage est imprimé en France. Le grammage de chaque référence est publié et filtrable : un t-shirt d’opération ponctuelle et un polo porté tous les jours ne se choisissent pas au même grammage.',
					'{NB_COLORIS} noms de coloris, regroupés en {NB_FAMILLES_COULEUR} familles de couleur. Les familles sont mesurées sur le nuancier du fabricant et non déduites du nom : deux « bleu nuit » de deux fabricants ne sont pas la même couleur, et un filtre qui les croit sur parole vous fait ouvrir des fiches pour rien.',
				),
				'links'      => array(
					array( 'label' => 'Voir les t-shirts', 'key' => 'categorie:t-shirts' ),
					array( 'label' => 'Voir les sweats', 'key' => 'categorie:sweats' ),
				),
			),
		),
		'faq'         => array(
			array(
				'q' => 'Puis-je commander moins de {MINIMUM_PIECES} pièces ?',
				'a' => 'Non. Le panier refuse en dessous et vous dit ce qui manque, et de combien. Le film et le réglage de la presse se paient une fois pour toute la série, et sous ce seuil ils pèsent plus que les vêtements.',
			),
			array(
				'q' => 'Y a-t-il un montant minimum en plus du nombre de pièces ?',
				'a' => 'Oui. Le panier demande {MINIMUM_PIECES} pièces, comptées sur la commande entière. Aucun montant minimum ne s’y ajoute.',
			),
			array(
				'q' => 'Puis-je mélanger les tailles sur une commande de {MINIMUM_PIECES} pièces ?',
				'a' => 'Oui. La répartition se saisit ligne par ligne, une quantité par taille, sous un seul visuel. Le prix unitaire ne change pas selon la répartition : les tailles d’un même modèle forment une seule ligne de commande, et c’est leur total qui décide du palier de quantité.',
			),
			array(
				'q' => 'Puis-je mélanger des t-shirts et des sweats pour atteindre le minimum ?',
				'a' => 'Oui pour le minimum, qui porte sur la commande entière. Non pour la remise de quantité, qui se compte référence par référence : des t-shirts et des sweats ne s’additionnent pas pour faire baisser le prix unitaire. Pour payer moins cher la pièce, il faut regrouper la quantité sur un même modèle plutôt que la répartir sur plusieurs.',
			),
			array(
				'q' => 'Le prix affiché comprend-il l’impression ?',
				'a' => 'Oui, et la grille complète est publiée sur chaque fiche produit, quantité par quantité. Ce qui est facturé est la surface d’encre réellement imprimée, pas le rectangle du fichier. Le prix s’affiche avant l’ajout au panier.',
			),
			array(
				'q' => 'En combien de temps une petite série est-elle expédiée ?',
				'a' => '{DELAI_STANDARD} jours ouvrés entre la validation de votre bon à tirer et l’expédition, puis Colissimo en France métropolitaine. Nous ne publions pas de délai plus court, parce que nous ne le tiendrions pas.',
			),
			array(
				'q' => 'Faites-vous de la broderie sur une petite série ?',
				'a' => 'La broderie passe par un devis et elle est sous-traitée : elle n’est pas faite dans notre atelier. Nous ne vous annoncerons pas de délai de broderie tant qu’il ne dépend pas de nous. En autonomie sur le site, la technique est le DTF.',
			),
		),
	),

	'page:fichiers-impression' => array(
		'title'       => 'Quel fichier envoyer pour une impression textile',
		'description' => 'Le format, le fond, la définition et la taille en centimètres. Ce que nous regardons dans votre fichier, et ce qui empêche une impression.',
		'h1'          => 'Quel fichier envoyer pour une impression textile',
		'intro'       => array(
			'Le fichier d\'un logo existe rarement en une seule version : celui de la signature de mail n\'est pas celui des cartes de visite, et aucun des deux ne dit s\'il tiendra dans une zone d\'impression, ni ce qu\'il donnera une fois pressé sur du tissu.',
			'Cette page prend les questions dans l\'ordre où elles se posent : le format du fichier, son fond, sa définition, puis sa taille en centimètres. Elle décrit ce que nous faisons de votre fichier en DTF, la seule technique commandable directement sur ce site ; la broderie, le flocage et la sublimation passent par un devis.',
			'Un ordre de grandeur pour commencer : sur un t-shirt en taille {TAILLE_MESUREE}, la face avant offre {ZONE_TSHIRT}, et c\'est dans ce cadre que votre visuel doit entrer.',
		),
		'sections'    => array(
			array(
				'h2'         => 'Le format : ce qui se dépose et ce qui ne se dépose pas',
				'paragraphs' => array(
					'L\'éditeur en ligne accepte les images : PNG, JPEG, SVG. Un PDF ou un fichier Illustrator ne s\'y dépose pas. Si c\'est le seul fichier dont vous disposez, la marche à suivre est juste en dessous.',
					'Un fichier vectoriel (SVG, PDF, AI) n\'a pas de définition : il est décrit par des tracés, donc il s\'agrandit sans se dégrader. C\'est le meilleur point de départ. Un SVG déposé dans l\'éditeur est converti en image à partir de ces tracés, et non d\'un agrandissement.',
					'Le JPEG est le moins bon des trois pour un logo. Il compresse en lissant les zones voisines, ce qui laisse un halo autour des lettres noires sur un fond uni, et il ne sait pas stocker de transparence : un JPEG a toujours un fond, même quand votre écran blanc vous le cache.',
				),
				'list'       => array(
					'PNG à fond transparent : le format à demander si vous n\'en demandez qu\'un.',
					'SVG : converti en image nette au moment de l\'import, à partir du tracé et non d\'un agrandissement.',
					'JPEG : accepté, mais sans transparence, et avec des halos possibles autour des lettres sur fond uni.',
					'PDF, AI, EPS : à faire convertir en PNG à fond transparent avant de l\'envoyer.',
				),
				'after'      => array(
					'Quand vous ne savez pas quoi demander à la personne qui a fabriqué le logo, une phrase suffit : le logo en PNG à fond transparent, exporté grand. Si vous ne savez plus à qui vous adresser, décrivez le fichier dont vous disposez dans une demande de devis : le formulaire pose la question.',
				),
				'links'      => array(
					array( 'label' => 'Décrire votre fichier dans une demande de devis', 'key' => 'page:devis' ),
				),
			),
			array(
				'h2'         => 'Le carré blanc autour du logo s\'imprime',
				'paragraphs' => array(
					'Cette erreur ne se voit pas à l\'écran. Un logo posé sur un fond blanc dans le fichier est imprimé avec ce fond : sur un vêtement foncé, un rectangle blanc apparaît autour du logo. Rien dans la chaîne ne l\'enlève, parce que rien ne peut deviner que ce blanc n\'était pas voulu.',
					'Ouvrez le fichier et regardez ce qu\'il y a derrière le logo. Un damier gris et blanc signifie que le fond est transparent. Du blanc reste du blanc, et il sera déposé sur le tissu comme le reste du visuel.',
					'Dans la bibliothèque d\'imports de l\'éditeur, un bouton « Détourer » retire l\'arrière-plan d\'une image sur votre appareil, sans que rien soit envoyé ailleurs. Il est conçu pour une photo, où le sujet se détache de son arrière-plan. Sur un logo au trait, la bonne réponse reste le fichier d\'origine à fond transparent.',
				),
			),
			array(
				'h2'         => 'La définition se juge à la taille imprimée',
				'paragraphs' => array(
					'Ce qui compte n\'est pas l\'allure du fichier à l\'écran, mais son nombre de pixels rapporté aux centimètres imprimés. Le même logo passe très bien en petit sur une poitrine et devient granuleux étalé sur toute une face avant : le fichier n\'a pas changé, la surface si.',
					'L\'éditeur fait ce calcul pour vous. Dans « Partager & exporter », il compare les pixels de chaque visuel aux centimètres où vous venez de le poser, et signale ceux qui risquent d\'imprimer flou, en PPP (points par pouce) à cette taille. C\'est cette mesure qu\'il faut regarder, pas le poids du fichier.',
					'Envoyer un fichier plus lourd ne rattrape pas tout : l\'éditeur travaille sur une copie ramenée à une taille de travail, et c\'est cette copie que la mesure regarde. Un fichier trop petit pour la taille voulue ne se répare pas, il se remplace : un agrandissement n\'ajoute pas le détail manquant, il ajoute du flou. C\'est un point à régler avant la commande, pas au bon à tirer.',
				),
			),
			array(
				'h2'         => 'Nous mesurons l\'encre, pas le cadre',
				'paragraphs' => array(
					'Un logo exporté en PNG traîne souvent une large marge transparente, parce que l\'export a gardé le format de la maquette. Quand le calcul part du rectangle du fichier, cette marge vide est achetée en film et refacturée. Ici, le prix est calculé sur la surface d\'encre réellement déposée.',
					'Ce n\'est pas une nuance comptable : sur le même visuel, le rectangle du fichier et l\'encre réellement déposée ne mesurent pas la même chose.',
					'Conséquence pratique : ne recadrez pas votre fichier au plus juste avant de l\'envoyer. Vous n\'y gagnerez rien sur le prix et vous risquez de rogner le bas d\'une lettre.',
				),
			),
			array(
				'h2'         => 'La place du logo, en centimètres',
				'paragraphs' => array(
					'La zone imprimable est publiée sur chaque fiche produit, en centimètres. Vous pouvez donc mesurer votre visuel et savoir avant de commander s\'il tient, au lieu de le découvrir sur le bon à tirer.',
					'Pour un t-shirt en taille {TAILLE_MESUREE}, la face avant mesure {ZONE_TSHIRT}.',
					'Le vêtement change de taille, la zone aussi. Selon l\'option retenue, le marquage est mis à l\'échelle avec le vêtement, plus petit sur un S et plus grand sur un XL, ou pressé aux mêmes dimensions sur toutes les tailles. Quand la mise à l\'échelle est connue, le bon à tirer dit laquelle des deux s\'applique.',
					'Sur ce bon à tirer, chaque face est chiffrée : la surface imprimée en cm², les dimensions du visuel, sa hauteur sous le bord de la zone et son décalage par rapport à l\'axe. Quand la face a une couture d\'encolure, le centre de la zone est aussi coté sous celle-ci ; une manche n\'en a pas, et le document le dit au lieu d\'inventer un repère. Un logo poitrine placé trop bas se corrige à ce moment-là, en une phrase, avant que la presse chauffe.',
				),
				'links'      => array(
					array( 'label' => 'Les t-shirts et leurs zones d\'impression', 'key' => 'categorie:t-shirts' ),
					array( 'label' => 'Les sweats et leurs zones d\'impression', 'key' => 'categorie:sweats' ),
				),
			),
			array(
				'h2'         => 'Le DTF, en clair',
				'paragraphs' => array(
					'DTF veut dire Direct To Film. Le visuel est imprimé sur un film, puis transféré sur le vêtement sous presse à chaud. Sur un textile foncé, l’aperçu du studio est volontairement prudent : un visuel semi-transparent y laisse voir la couleur du vêtement au travers, et ce que vous recevrez ne sera jamais moins bon que ce que l’aperçu montre.',
					'C\'est la seule technique commandable directement sur ce site. La broderie, le flocage et la sublimation existent et passent par un devis. La broderie est sous-traitée : nous ne publions donc pas de délai pour elle.',
					'Le DTF pose une matière sur le tissu, il ne le teint pas. Et l\'écran ne dit pas la couleur finale : sur le bon à tirer, jugez le placement et les dimensions, pas la teinte exacte.',
				),
			),
			array(
				'h2'         => 'Ce qui se passe une fois le fichier envoyé',
				'paragraphs' => array(
					'Le prix s\'affiche avant l\'ajout au panier, impression comprise. Il baisse par paliers de quantité, et le palier se calcule sur la quantité d\'une même référence : ce sont les pièces de ce modèle, avec ce marquage, qui décident du tarif de cette ligne. La grille complète est publiée sur chaque fiche produit.',
					'La conséquence est un conseil d\'achat et pas un détail de calcul : une même quantité regroupée sur une seule référence atteint un palier que la même quantité répartie sur trois modèles n\'atteint pas, puisque chaque référence compte pour elle seule. Quand le choix est ouvert, grouper coûte moins cher que répartir.',
					'Le minimum de commande, lui, se compte sur le panier entier : {MINIMUM_PIECES} pièces, toutes références confondues. C\'est la seule condition : aucun montant minimum ne s\'y ajoute.',
					'La répartition des tailles se saisit ligne par ligne : vous n\'avez pas à prendre le même nombre de chaque taille pour atteindre la commande minimum.',
					'Le bon à tirer se valide en ligne, sans créer de compte. L\'impression est faite en France, et l\'expédition part en Colissimo, en France métropolitaine.',
					'À partir de la validation du bon à tirer, comptez {DELAI_STANDARD} jours ouvrés jusqu\'à l\'expédition. Aucun délai plus court n\'est proposé sur ce site : nous ne publions pas une date que l\'atelier ne tient pas.',
				),
				'links'      => array(
					array( 'label' => 'Commander en petite série', 'key' => 'page:petites-series' ),
					array( 'label' => 'Parcourir le catalogue', 'key' => 'boutique' ),
				),
			),
		),
		'faq'         => array(
			array(
				'q' => 'Mon logo est en JPEG, est-ce que ça peut marcher ?',
				'a' => 'Pour une photo, oui. Pour un logo sur fond uni, non : un JPEG ne stocke pas la transparence, donc le fond blanc du fichier est imprimé, et la compression laisse un halo autour des lettres. Demandez un PNG à fond transparent à la personne qui a fabriqué le logo : c\'est une exportation courante, pas un travail de création.',
			),
			array(
				'q' => 'Je n\'ai que le PDF de mes cartes de visite. Que faire ?',
				'a' => 'Le PDF ne se dépose pas dans l\'éditeur en ligne, mais il contient souvent le logo en vectoriel, c\'est-à-dire la meilleure version qui existe. Demandez à celui qui l\'a produit un PNG à fond transparent, ou le fichier SVG. Si vous ne savez plus à qui vous adresser, décrivez le fichier dont vous disposez dans le formulaire de devis.',
			),
			array(
				'q' => 'Comment savoir si mon fichier est assez net ?',
				'a' => 'Posez-le dans l\'éditeur à la taille où il sera imprimé, puis ouvrez « Partager & exporter » : les visuels trop peu définis pour cette taille y sont signalés comme pouvant imprimer flou, avec les PPP obtenus. Un agrandissement ne rattrape rien puisqu\'il n\'ajoute aucun détail. Un fichier trop juste se remplace par une version plus grande, ou par le tracé vectoriel d\'origine.',
			),
			array(
				'q' => 'Le DTF, qu\'est-ce que c\'est ?',
				'a' => 'Direct To Film : le visuel est imprimé sur un film, puis pressé à chaud sur le vêtement. C’est la seule technique commandable directement ici ; la broderie, le flocage et la sublimation passent par un devis. Sur un vêtement foncé, l’aperçu montre le rendu le plus prudent des deux possibles, jamais le plus flatteur.',
			),
			array(
				'q' => 'Quelle taille et quelle position pour un logo poitrine ?',
				'a' => 'La zone imprimable est publiée sur chaque fiche, en centimètres : {ZONE_TSHIRT} pour un t-shirt en taille {TAILLE_MESUREE}, face avant. Un logo poitrine n\'occupe qu\'une partie de la zone imprimable, et vous le placez vous-même dans l\'éditeur. Le bon à tirer redonne ensuite ses dimensions, sa hauteur sous le bord de la zone et son décalage par rapport à l\'axe, en centimètres.',
			),
			array(
				'q' => 'Les marges vides autour de mon logo me sont-elles facturées ?',
				'a' => 'Non. Le prix est calculé sur la surface d\'encre réellement imprimée, pas sur le rectangle dans lequel le fichier a été déposé. Un PNG entouré de transparent coûte le prix du logo. Vous n\'avez donc pas à recadrer avant d\'envoyer.',
			),
			array(
				'q' => 'Le prix baisse-t-il si je commande plusieurs modèles à la fois ?',
				'a' => 'Le palier de quantité se calcule sur une même référence, pas sur le panier : des t-shirts et des polos dans la même commande gardent chacun leur propre palier. Le minimum de commande, lui, se compte bien sur le panier entier, en pièces et en montant hors taxes. Autrement dit, mélanger les modèles aide à atteindre le minimum, pas à faire baisser le prix unitaire.',
			),
		),
	),

	'page:devis' => array(
		'title'       => 'Demander un devis pour un projet textile',
		'description' => 'Le vêtement, la quantité, la répartition des tailles et votre date. Nous revenons avec un chiffrage et le délai que l’atelier tient.',
		'h1'          => '',
		'intro'       => array(
		),
		'sections'    => array(
		),
	),

);
