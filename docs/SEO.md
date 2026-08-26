# Se faire trouver : ce que nous visons, pourquoi, et comment nous saurons

État au **26 août 2026**, séance 11. Ce document dit ce que le site cherche à obtenir des
moteurs de recherche, sur quelles preuves, et à quoi on verra que cela marche ou non. Il ne
promet pas de trafic : la dernière section explique pourquoi personne ne peut en promettre
ici sans inventer un chiffre.

Le plan de l'associé est au chapitre 7 de la Bible
(`docs/bible/07_Prospection_et_marketing/`). Ce qu'il en reste après vérification est en fin
de document.

---

## 1. Ce que nous avons mesuré avant de décider

Trois relevés, tous refaisables.

**Les concurrents, en lisant leur HTML.** mistertee.fr, tostadora.fr, et les six domaines
qui reviennent le plus souvent sur nos douze requêtes cibles : vetement-publicitaire.com,
label-blouse.net, la-manufacture.fr, tissus-print.com, pubavenue.com, laboutiquedupro.com,
vistaprint.fr. Relevé le 26 août 2026.

**Les requêtes réelles, par l'autocomplétion.** 1 302 appels aux points d'entrée publics de
Google et de Bing depuis une adresse résidentielle française, 2 824 complétions brutes,
273 uniques après nettoyage. Ce sont de vraies formulations, ce ne sont **pas** des volumes.

**Ce que notre propre site servait**, page par page, sur le miroir local.

---

## 2. Ce que la recherche a changé au plan

### La page qui gagne n'est presque jamais une page catégorie

Sur douze requêtes, la page d'atterrissage construite pour l'intention en gagne sept, la
catégorie de boutique trois, l'éditorial deux. Le cas le plus net est
« tenue restaurant personnalisée » : **neuf résultats sur neuf** sont une page de secteur,
une catégorie découpée par secteur ou un article de secteur, et aucun n'est une catégorie
produit générique.

vetement-publicitaire.com le démontre en négatif : leur plan de site contient
**47 pages** et 242 produits, dont 31 pages « un vêtement personnalisé » et 8 pages de
secteur. Leur boutique WooCommerce n'est jamais la page qui se classe. Les pages se
classent, la boutique convertit.

C'est pour cela que cette séance construit six pages de secteur et deux guides avant
d'ajouter quoi que ce soit au catalogue.

### La copie va SOUS la grille produits

Mesuré en ordre du document, mots de texte courant avant le premier lien produit contre
après : laboutiquedupro 0 / 809, tissus-print 25 / 1 764, vetement-publicitaire 42 / 1 049,
label-blouse 68 / 859, la-manufacture 145 / 3 239. mistertee.fr publie **24 mots** au-dessus
de sa grille `/t-shirts`, tous des libellés de filtres, et **2 822 mots** en dessous.

Cinq sur cinq. `template-parts/shop.php` fait la même chose : une à trois phrases au-dessus,
le reste dessous.

### « À l'unité » est la formulation la plus demandée du marché, et nous ne pouvons pas
### l'employer

Dix-neuf complétions distinctes attachent « à l'unité » au t-shirt, au sweat, au sweat
zippé, au pull, au polo, au polo brodé, à la broderie, au flocage et à l'impression DTF, et
les deux moteurs la rendent indépendamment. « petite quantité » n'en rend que trois, dont
une sur des bracelets.

Notre minimum est de cinq pièces. Des concurrents ont déjà l'URL dédiée
(`atelierduquai.com/sweat-personnalise-a-lunite/`, distincte de `/sweat-personnalise/`).
Nous visons donc « à partir de 5 pièces » et « petite série », en sachant que c'est la
formulation la plus faible, et la page `/petites-series/` explique le seuil au lieu de le
cacher. **C'est un arbitrage commercial, pas technique** : si l'associé descend le minimum,
la requête la plus demandée du marché s'ouvre.

### Trois corrections de vocabulaire, contre les hypothèses du brief

- « tenue restaurant personnalisée » ne rend **aucune** complétion chez Google. Bing la
  réécrit vers la cuisine. Le mot du marché est « tenue de cuisine » ou « tenue de service ».
- « professionnel » se réécrit massivement vers « entreprise » dans l'autocomplétion.
  L'acheteur dit **entreprise**.
- « association » et « club sportif » sont deux vocabulaires distincts, et « pas cher »
  s'attache au premier et jamais au second ni à « entreprise ».

### Deux pièges nommés par les données

**Les requêtes de technique sont polluées par les acheteurs de machines** :
« machine impression dtf prix », « quelle imprimante pour impression dtf »,
« matériel pour flocage textile ». Une page qui se classerait sur « prix impression DTF »
collecterait des amateurs et des revendeurs. Ces mots sont à mettre en négatif avant le
premier euro de publicité.

**L'espace des questions est du bricolage**, pas de l'achat professionnel : les 26 questions
relevées sont « comment personnaliser un t-shirt avec un fer à repasser », « comment faire
un t-shirt personnalisé sur Roblox ». Trois exceptions, toutes de pré-achat :
« quel fichier pour impression t shirt », « quel format pour impression t shirt »,
« impression dtf textile c est quoi ». C'est exactement la page `/fichiers-impression/` et
rien d'autre. **Une stratégie de blog par questions attirerait des gens qui cherchent
explicitement à ne pas nous payer.**

---

## 3. La politique d'indexation

Le problème, en chiffres : 458 références publiées, 24 par page, dix facettes, six valeurs
de tri, deux espaces de pagination. Sans règle, cela fait des dizaines de milliers d'URL
quasi identiques.

*Corrigé le 26 août :* la première version de ce document et le premier commentaire du code
disaient que le plan de site omettait « T-shirts et Polos ». Il n'en omettait qu'un,
`t-shirts`, dont le compte brut est à zéro ; `polos` porte 2 et 2 est au-dessus de zéro. Le
défaut et sa gravité ne changent pas, la phrase si.

### Les adresses, en français

WooCommerce adressait le catalogue en anglais : `/categorie/t-shirts/` et
`/product/{slug}/`, sur une boutique qui ne vend qu'en France. Le chapitre 04 demande
« URL courte » et `product-category` est la plus longue base que WooCommerce livre.

**C'est fait, et le moment compte plus que le choix.** Les bases sont désormais `produit` et
`categorie`, posées par `wp teeshoop provisionner`. Le raisonnement est écrit dans
`Cli::ensure_french_bases()` : ces adresses ne désignent aujourd'hui que les 44 produits de
démonstration que la question 20 demande de supprimer, aucune URL du vrai catalogue n'existe
en production, et après la mise en ligne le même changement coûterait 463 redirections.

Le **slug de la page boutique**, lui, ne bouge pas, et c'est la même règle lue dans l'autre
sens : `Cli::ensure_french_shop_pages()` documente que `wp_old_slug_redirect()` ne redirige
jamais une PAGE renommée (elle est appariée sur `pagename`, la fonction commence par
`if ( is_404() && '' !== get_query_var( 'name' ) )`), et teeshoop.com vend depuis 2024.

Les anciennes bases anglaises répondent **301** vers les nouvelles, chaîne de requête
comprise, et seulement sur une 404 : `Seo::english_base()`. WordPress redirige la base
produit tout seul, il ne redirige pas la base catégorie, et `/product-category/tout/` est
justement la seule catégorie que le site en ligne sert aujourd'hui.

Les slugs des pages de secteur sont courts (`/associations/`, `/clubs-sportifs/`) plutôt
qu'exacts (`/t-shirt-personnalise-association/`). Les deux formes existent sur le marché :
vetement-publicitaire.com a 31 pages en slug exact, mistertee.fr range les siennes sous
`/professionnels/{secteur}`. Les mots d'une URL pèsent très peu au classement et un slug
coûte cher à changer dès que quelque chose y pointe, donc ce sont les courts. La requête vit
dans la balise title et dans le `h1`, là où elle gagne le clic.

### Indexable, et canonique vers elle-même

| Motif | Note |
|---|---|
| `/` | |
| `/shop/` et `/shop/page/N/` | canonique vers **elle-même, numéro de page compris** |
| `/categorie/{famille}/` et `/page/N/` | idem, avec `rel=prev` et `rel=next` |
| `/produit/{slug}/` | |
| les pages de secteur, les guides, `/devis/`, `/entreprises/` | |

**La pagination reste indexable, et c'est une rupture délibérée avec les deux concurrents.**
mistertee sert `noindex,follow` sur `/t-shirts?page=1` et suivantes. C'est juste à leur
échelle (968 URL soumises) et faux à la nôtre : avec 24 références par page, T-shirts fait
8 pages et Sweats 7, donc la recette cacherait **87 %** du catalogue. Ce que nous leur
prenons, c'est la moitié qu'ils font bien : la page 2 se canonicalise sur elle-même et
jamais sur la page 1.

### Les 26 392 déclinaisons, qui sont le vrai piège

Chaque référence variable s'adresse aussi par ses attributs :
`/produit/{slug}/?attribute_pa_couleur=black&attribute_pa_taille=m`. 463 références par leurs
coloris et leurs tailles font **26 392 combinaisons**, toutes joignables par URL. C'est la
façon la plus courante pour une boutique WooCommerce de se saborder toute seule.

La politique : **indexable, et canonique vers l'URL propre du produit.** Pas `noindex`, parce
que cela contredirait le canonical, ce qui est précisément l'erreur décrite plus bas. Le
noyau s'en charge (`wp_get_canonical_url()` retire la chaîne de requête sur une page
singulière) et `Seo` la reprend telle quelle. Vérifié, et désormais asserté par
`npm run verify:seo` sur une vraie déclinaison plutôt que supposé.

### `noindex, follow`, et délibérément **aucun** canonical

Les dix facettes en toute combinaison, le tri, la recherche interne, le panier, la commande,
le compte, l'éditeur (`?personnaliser=1`), les arguments de l'estimateur, les archives
d'auteur et de date, et **les sous-catégories tant que personne ne leur a écrit de texte**.

Cette dernière règle mérite son paragraphe. « Manches courtes » porte 139 des 184 références
de « T-shirts », et « Manches courtes » sous Polos en porte 88 sur 104. Deux pages qui
listent les trois quarts de la même grille sous deux titres, c'est le quasi-doublon que le
chapitre 4 signale, et c'est ce qu'un import produit par défaut. La règle n'est pas
« cacher les enfants », c'est **« une page entre dans l'index le jour où elle a quelque
chose à dire »** : une entrée dans `Content::pages()` la rend indexable. L'indexation suit
une décision éditoriale et non un import.

### La règle qu'il est facile de prendre à l'envers

**Une page en `noindex` ne porte AUCUN canonical.** Les deux consignes se contredisent et
Google documente que le `noindex` peut voyager le long du canonical. Sur cette boutique,
chaque liste filtrée est en `noindex` et aurait pointé vers sa catégorie : **les filtres
auraient pu désindexer les pages qu'ils desservent.**

La preuve que ce n'est pas théorique : mistertee.fr sert aujourd'hui, sur
`/t-shirts?f[0]=field_brand:8128`, un `noindex,follow` **et** un canonical vers `/t-shirts`.
Vérifié sur deux URL de facette différentes.

`Seo` ne décide pas qui est en `noindex`. Il **observe** le tableau `wp_robots` final à
`PHP_INT_MAX`, après WordPress, WooCommerce, `ProductPage::robots()` et la règle de facettes
du thème, et refuse d'imprimer un canonical quand la réponse est `noindex`. Celui qui
ajoutera la onzième règle obtient le comportement sans le savoir.

### `robots.txt` bloque presque rien

Seulement `/wp-json/`, `/wp-login.php`, `/*?wc-ajax=` et les lignes que WooCommerce ajoute.

**`Disallow` et `noindex` ne sont pas deux forces de la même consigne.** Une URL interdite
n'est jamais chargée, donc son `noindex` n'est jamais lu, et Google est explicite : une telle
URL peut quand même apparaître en résultat sous forme de lien nu. Tout ce qui a une page
porte sa consigne dans la page et doit donc rester **explorable**.

tostadora.fr montre le coût de l'erreur : ils bloquent `/*?s=` et rendent Googlebot incapable
de lire ni le `noindex` ni le canonical d'une page pour laquelle ils avaient écrit une
description française à la main.

**Ce que cela nous coûte, et qui n'est pas réglé :** l'espace des facettes reste explorable
devant une page catégorie mesurée à 2 431 ms. Le levier disponible est `rel="nofollow"` sur
les liens de facette, qui décourage l'exploration sans empêcher la lecture du `noindex`. Il
n'est **pas** posé, parce que nous n'avons aucune mesure du comportement des robots sur ce
site. À poser si la Search Console montre du temps d'exploration parti dans les facettes.
C'est aussi une entrée de la séance 13, qui possède la performance.

---

## 4. Les données structurées

Une règle avant les autres : **aucun `AggregateRating`, aucun `Review`, sur aucune page,
tant qu'il n'existe pas de vrais avis recueillis par un procédé vérifiable.** Il y en a zéro
dans `wp_comments`. En France un avis fabriqué ou mal attribué est une pratique commerciale
trompeuse, et `scripts/seo-verify.mjs` cherche les chaînes elles-mêmes sur chaque type de
page, pas seulement les nœuds analysables.

Les deux concurrents audités livrent l'abus, ce qui sert d'avertissement plutôt que de
modèle : mistertee injecte sur chaque catégorie un `{"aggregateRating":{"ratingValue":4.7,
"ratingCount":12953}}` dont le nœud englobant n'a pas de `@type` ; tostadora recopie la note
du **modèle de vêtement** sur des visuels sans rapport (trois motifs différents portent le
même 4.6 / 7651) et réutilise ce 7651 sur une page entreprises qui ne vend aucun produit.

| Type de page | Ce que nous émettons |
|---|---|
| Toutes | un `Organization` sous un `@id` stable |
| Accueil | plus un `WebSite` avec son `publisher` |
| Catégorie et boutique | `BreadcrumbList` (celui de WooCommerce), **pas d'`ItemList`, pas de `Product`** |
| Fiche sans prix (456 sur 458) | `Product` + `Brand` + `BreadcrumbList`, **sans `offers`** |
| Fiche avec prix | plus un `AggregateOffer` dont les deux bornes sont des cellules de la grille imprimée sur la page |
| Secteur et guides | `BreadcrumbList` |

**L'`Organization` devient un `LocalBusiness` tout seul** le jour où la question 17 donne une
adresse : `address` est la propriété que Google exige d'un `LocalBusiness`, donc en émettre
un sans adresse serait du balisage invalide sur chaque page du site.

**Pas de `FAQPage`**, et c'est une décision datée : en août 2023 Google a restreint les
résultats enrichis de FAQ aux sites gouvernementaux et de santé reconnus. Sur un site
marchand, ce balisage ne produit plus rien. Les questions restent, en vrai contenu, parce
qu'elles répondent à ce qu'un acheteur demande. Si Google rouvre ce résultat, la FAQ est déjà
dans `Content::page()['faq']` et le balisage se rend depuis ce même tableau.

**Pas de `hreflang`** (une langue, un marché, question 35) et **pas de
`MerchantReturnPolicy`** : le personnalisé n'ouvre pas de droit de rétractation en France, et
publier une politique de retour avant que les CGV soient écrites serait une promesse que
personne ne tient. tostadora en publie une, de 90 jours.

---

## 5. Ce que nous savons des mots-clés, et ce que nous ne savons pas

**Ce qui est réel dans ce dossier :** 273 formulations que Google ou Bing ont vues assez
souvent pour les suggérer, le 26 août 2026, depuis la France. Elles tranchent des décisions
de rédaction, et elles l'ont fait (section 2).

**Ce qui n'y est pas :** un seul volume, un seul coût par clic, une seule difficulté, une
seule position vérifiée. L'ordre des complétions **n'est pas** un ordre de volume.

Trois des formulations que le brief supposait, « t-shirt personnalisé entreprise Paris »,
« tenue restaurant personnalisée » et « sweat personnalisé club sportif », rendent **zéro**
complétion chez Google, alors que le même passage en rendait 366 pour « tshirt personnalisé »
sans une seule erreur. Ce zéro est la mesure, pas une panne : ces requêtes sont de la longue
traîne à très faible volume. Cela ne les rend pas sans valeur, elles sont aussi sans
concurrence et à forte intention, mais **elles ne peuvent pas être présentées comme un plan
de trafic.**

### Comment on obtient de vrais chiffres, dans l'ordre

1. **Planificateur de mots-clés Google Ads**, gratuit. À la création du compte, passer en
   « mode Expert » puis « créer un compte sans campagne » : aucune carte n'est débitée.
   Coller les 273 termes, France, français. On obtient des **tranches** (10-100, 100-1 000,
   1 000-10 000), ce qui suffit largement pour choisir huit pages.
2. **Bing Webmaster Tools**, gratuit, pour classer les termes les uns par rapport aux autres.
   Jamais comme un chiffre Google : Bing pèse quelques pour cent de la recherche en France.
3. **Search Console et Bing Webmaster, vérifiés le jour de la mise en ligne**, par
   enregistrement DNS pour survivre à un changement d'hébergeur. Ni l'un ni l'autre ne
   rattrape le passé, la rétention de la Search Console est de 16 mois glissants, donc un
   export mensuel dans un fichier commence au mois un. Compter 8 à 12 semaines avant que le
   rapport de requêtes soit décisionnel.
4. **Un test publicitaire** de 4 à 6 semaines en exact sur dix termes, s'il a lieu, apprend
   plus qu'un volume et débloque les chiffres non tranchés en effet de bord. C'est de
   l'argent qui sort, donc c'est la décision de l'associé.
5. Un outil payant en dernier, et seulement pour la chose qu'aucun des précédents ne donne :
   ce sur quoi les concurrents se classent déjà.

Google Trends ne donne jamais un volume absolu, seulement un intérêt relatif noté de 0 à 100.
Utile pour la saisonnalité, c'est tout.

---

## 6. Mesure et consentement

Le détail est dans `includes/Consent.php` et `includes/Funnel.php` ; ici, la décision.

**Le tunnel se compte sur des enregistrements, pas sur un traceur.** Une demande de devis est
un article avec un statut, une commande est une commande avec un total. Les compter n'écrit
rien sur la machine de personne, ne traite aucune donnée personnelle en agrégat, ne demande
aucun consentement, et coûte une requête par rapport au lieu d'une écriture par page vue sur
un hébergement mutualisé où une page catégorie prend déjà 2 431 ms. **Nous ne comptons pas
les visites** : la Search Console et le journal d'accès du serveur les donnent gratuitement.

**Une seule chose demande un consentement**, et c'est celle que le chapitre 7 nomme parmi ses
propres risques (« mauvaise attribution ») : savoir quelle page a produit une demande de
devis. Porter une page d'arrivée sur deux ou trois pages veut dire écrire un identifiant sur
un terminal, et le rattacher ensuite à un prospect nommé veut dire que ce ne sont pas des
statistiques anonymes. Ce n'est donc pas exempté au titre de la mesure d'audience. C'est
opt-in, et c'est la seule chose derrière le bandeau.

La **catégorie publicitaire est déclarée et non proposée** : aucun identifiant de régie n'est
enregistré, et demander la permission d'un marqueur qui n'existe pas collecterait une
autorisation pour rien.

Ce que la boutique connaît toujours, sans permission : le **chemin** de la page sur laquelle
le formulaire a été envoyé, jamais sa chaîne de requête. C'est ce qui répond à la question
qu'une page d'atterrissage existe pour poser.

**L'origine est saisie au moment du consentement, et pas après.** C'est la passe adverse qui
l'a trouvé : lue à la requête suivante, comme c'était le cas d'abord, le site référent est
déjà le nôtre et les arguments de campagne ont disparu, donc les deux champs pour lesquels on
demandait l'autorisation étaient structurellement toujours vides. Le bandeau s'affiche sur la
page d'arrivée, il porte donc le référent et la campagne de cette page-là.

**Ce qui manque encore, et qui appartient à la séance 12.** Le bandeau recueille un
consentement sans nommer le responsable de traitement et sans pouvoir ouvrir une notice : ni
mentions légales, ni politique de confidentialité n'existent, parce qu'elles demandent
l'identité légale (question 17) et un responsable désigné (question 19). Le mécanisme est
prêt et il pointe déjà vers `/confidentialite/` dès que cette page existe. **Rien ne doit être
mis en ligne avant.**

---

## 7. Comment nous saurons que cela a marché

Trois niveaux, du plus rapide au plus lent.

**Semaine 1, technique, et c'est un contrôle et non un chiffre.** `npm run verify:seo` doit
rester vert : **438 assertions**, chaque type de page indexable ou non selon la politique,
canonique vers elle-même, sans canonical quand elle est en `noindex`, avec sa description,
sans emplacement non résolu, sans avis, avec au moins 500 mots sur chaque page de secteur et
sans aucune des huit formules que la boutique ne peut pas tenir ; le plan de site sans compte
utilisateur, sans produit masqué et avec les trois familles ; et le consentement qui refuse
une acceptation forgée depuis un autre domaine.

**Semaines 4 à 12, indexation.** Search Console, rapport « Pages » : le nombre d'URL indexées
doit tendre vers le nombre d'URL du plan de site, et pas au-delà. Une indexation supérieure
au plan de site est le signal que les facettes sont entrées, et c'est la mesure qui
déclenche le `rel="nofollow"` de la section 3.

**Mois 3 à 6, requêtes puis demandes.** Dans l'ordre où cela arrive :

1. des impressions sur la marque « teeshoop » et sur les références de fabricant
   (« B&C E190 personnalisé »), qui ne demandent aucune autorité ;
2. des impressions sur les six pages de secteur, sur les formulations relevées en section 2 ;
3. des clics ;
4. **des demandes de devis dont la page d'origine est une page de secteur**, ce que l'écran
   Tunnel affiche, et c'est le seul chiffre qui compte vraiment.

L'écran Tunnel affiche déjà le nombre de demandes par page de formulaire, par page d'arrivée
et par site référent, avec le nombre de demandes sans origine dit à côté plutôt que caché.

---

## 8. Ce que nous pouvons raisonnablement viser à six mois, et ce que non

**Atteignable.**

- **Associations et clubs sportifs.** C'est notre meilleure ouverture : sur
  « sweat personnalisé club sportif », un seul acteur (totalsport.fr) a construit la page
  d'audience, tous les autres résultats sont des catégories génériques. Le vocabulaire est
  distinct et attesté, et notre minimum de cinq pièces convient mieux à un club qu'à
  quiconque.
- **La longue traîne marque et modèle** sur les fiches produit : 458 références réelles avec
  des faits fournisseur réels, une description dérivée par référence et un nœud `Product`.
  C'est de la surface de classement gratuite qui ne demande aucune rédaction.
- **Les pages de secteur** sur les formulations relevées, pas sur celles que le brief
  supposait.
- **Les deux guides**, dont « quel fichier envoyer », qui est la seule question de pré-achat
  du marché et dont la réponse est un fait sur notre propre atelier.
- **La marque**, « teeshoop ».

**Hors de portée à six mois, avec la raison.**

- **Les têtes de requête** (« t-shirt personnalisé », « vêtements personnalisés entreprise »,
  « polo brodé entreprise », « vêtement de travail personnalisé »). Tenues par Vistaprint,
  HelloPrint, TeamShirts, pubavenue (4 427 URL au plan de site) et label-blouse (424 URL de
  catégorie, 4 889 produits) sur des domaines anciens. Domaine neuf, zéro lien entrant.
- **Le local** (« t-shirt personnalisé entreprise Paris », « flocage textile Île-de-France »).
  En première position sur les deux : un annuaire, pagesjaunes.fr. Le reste est un bloc local
  qui demande une fiche Google Business Profile, qui demande une adresse vérifiable et un
  téléphone, qui demandent la question 17. **Ce n'est pas du développement, c'est une
  démarche.** C'est la question 55.
- **Tout ce qui repose sur des avis ou des réalisations.** Nous n'en avons aucun, et la voie
  rapide est un délit.
- **Les requêtes de technique et de prix de technique**, pour la raison de la section 2.

---

## 9. Ce qui n'est délibérément pas construit

**Une page « Textile personnalisé en Île-de-France ».** C'est la requête que le brief de
séance cite en exemple, et c'est le seul point de son cahier des charges qui n'est pas
livré. Une page de ville qui ne peut donner ni adresse, ni téléphone, ni horaires est ce que
Google appelle une *doorway page* : une infraction à ses règles, pas une astuce. Elle se
construit en une demi-journée le jour où la question 17 et la question 55 ont une réponse, et
elle a besoin de la fiche Google avant, pas après.

**Une page « vêtements de travail ».** C'est pourtant le filon le plus riche de tout le
relevé, avec 27 complétions Google qui nomment le bâtiment et l'agriculture par produit. Nous
ne publions ni softshell, ni parka, ni veste de travail, ni haute visibilité : trois familles,
t-shirts, polos et sweats. Une page sous ce titre serait une promesse que le catalogue
dément. **La réponse est une décision de catalogue, pas de rédaction** : quelles familles
fournisseur importer.

**Un blog de questions.** Voir section 2 : l'espace des questions est du bricolage.

**Un balisage `FAQPage`.** Voir section 4.

**Une page « grossiste ».** « grossiste tee shirt personnalisé » revient dans les complétions
et le mot est ambigu : un revendeur qui veut du textile nu (pas notre client) et un acheteur
qui veut du volume (très exactement notre client) tapent la même chose. Rien ne les sépare
avant que l'associé dise lequel des deux nous servons.

---

## 10. Le chapitre 7, ce qu'il en reste

Sur ses dix priorités SEO, **trois** sont exécutables en l'état : pages sectorielles, guides,
données structurées. Voici les sept autres et pourquoi.

| Priorité du chapitre 7 | État |
|---|---|
| catégories fortes | les pages catégorie ne portaient **aucun** texte, parce que `Taxonomy` crée les termes sans description. Construit cette séance. |
| pages villes | bloquée sur les questions 17 et 55, et c'est une démarche administrative |
| pages sectorielles | construit |
| guides | construit, deux plutôt que quatre : le guide broderie décrirait une capacité sous-traitée et le guide DTF viserait des acheteurs de machines |
| fiches enrichies | contredit par notre propre import, qui écrit la liste à puces du fournisseur mot pour mot sur 459 fiches. Corrigé par une description dérivée par référence, pas par de la prose |
| réalisations | il n'y en a aucune |
| Google Business Profile | question 55 |
| avis | il n'y en a aucun, et la voie rapide est un délit |
| données structurées | déjà en place avant cette séance, et elles suivaient le chapitre **4**, pas le 7 |
| vitesse | en échec mesuré : 2 431 ms sur une page catégorie, 3 090 ms sur `/shop/`, contre 2,5 s au budget du chapitre 6. Séance 13 |

La section SEO du chapitre 7 est la plus faible du chapitre : dix puces, aucune phrase de
spécification, et rien qui vienne de ce qui est vrai de cette entreprise. Elle omet en outre
quatre des neuf points de la section SEO du **chapitre 4**, qui est la seule spécification
SEO que la Bible contienne : « filtres non indexables par défaut », « canonical »,
« gestion des produits indisponibles », « maillage interne ». Ce sont précisément les quatre
qui décident du sort d'un catalogue à dix facettes. Ce qui est construit ici suit le
chapitre 4.

Ce que le chapitre 7 apporte vraiment, et qu'il faut garder : le script d'appel, qui est la
seule copie écrite dans la voix de Teeshoop ; la règle de commission, déjà implémentée ;
« pas d'envoi massif immédiat aux 150 000 contacts » ; et
« revenu par 1 000 entreprises contactées », le seul indicateur taillé pour une base finie
qui s'épuise.

---

## 11. Ce qu'il faut faire le jour de la mise en ligne

Dans cet ordre, et rien de tout cela n'est du développement.

1. Vérifier **Search Console** et **Bing Webmaster** par enregistrement DNS. Aucun des deux
   ne rattrape le passé : chaque semaine sans vérification est une semaine de données perdue
   définitivement.
2. Soumettre `https://teeshoop.com/wp-sitemap.xml`.
3. Ouvrir un compte Google Ads en mode Expert, sans campagne, et relever les tranches de
   volume des 273 termes.
4. Mettre en place l'export mensuel de la Search Console vers un fichier, à cause des 16 mois
   glissants.
5. Relire `docs/CONCURRENTS.md` et ce document : les deux sont datés, et les deux
   concurrents bougent.

---

## 12. Ce que la passe adverse a corrigé, pour mémoire

Cinq lentilles sur le diff de la séance, avant la mise à jour de la branche. Dix-neuf
constats, dont ceux-ci, chacun mesuré :

- **Le consentement était falsifiable depuis n'importe quel domaine.** Le jeton WordPress est
  identique pour tous les visiteurs déconnectés et imprimé dans chaque page. C'est l'origine
  qui refuse maintenant, et une requête sans origine est refusée aussi.
- **238 des 456 références publiaient une composition amputée d'une fibre**, la coupe se
  faisant à la première virgule. Règlement (UE) 1007/2011, article 16.
- **L'écran Tunnel comptait brut** : le total entier d'une commande remboursée, et les
  brouillons du tunnel de paiement comme des commandes.
- **`/page/1/` pouvait se rediriger vers lui-même** indéfiniment, sur une URL forgée.
- **Le nombre de références se contredisait dans sa propre phrase** : 458 annoncés, 456 dans
  le détail imprimé à côté, parce que « Uncategorized » entrait dans la somme.
- **274 fils d'Ariane nommaient une catégorie que le même fichier met en `noindex`.**
- **Le lien du pied de page donnait à chaque URL du site un jumeau explorable** via
  `?cookies=1`.
- **`/entreprises/` et `/categorie/t-shirts/` publiaient le même `<title>`**, c'est-à-
  dire la cannibalisation manuelle de la requête la plus disputée du site.
- **Zéro se résolvait comme un chiffre** : un minimum effacé publiait « Nous imprimons à
  partir de 0 pièces ».
- **Un `data/copy.php` manquant était une erreur fatale** sur chaque page, et non quelques
  paragraphes en moins.

Deux affirmations du code ont aussi été corrigées parce qu'elles étaient fausses : le retrait
du consentement n'efface pas les copies déjà portées par une demande de devis (elle a sa
propre conservation et sa propre voie d'effacement), et la catégorie « attribution » décrit
maintenant les trois chaînes réellement écrites plutôt que « un identifiant ».
