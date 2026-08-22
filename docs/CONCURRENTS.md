# Ce que font mistertee.fr et tostadora.fr, et ce que nous faisons autrement

Relevé le **19 août 2026**, en lisant le HTML servi par les deux sites, pas leur
communication. Chaque affirmation ci-dessous est vérifiable en rechargeant la page citée.
Les deux sites bougent : la date compte, et une relecture avant la mise en ligne (séance
14) est nécessaire.

Ce document existe parce que la séance 09 avait à construire un site et qu'on ne conçoit
pas dans le vide. Il dit ce qui a été **repris**, ce qui a été fait **délibérément
autrement**, et pourquoi.

---

## Les deux concurrents en une phrase

**mistertee.fr** est notre concurrent direct : un atelier français (Le Mans, 88 rue Albert
Einstein), un catalogue de textiles nus à personnaliser, un éditeur maison, un parcours
devis. C'est le site à battre, et il est bon.

**tostadora.fr** est le concurrent de volume, et ce n'est pas le même métier : environ
50 000 visuels d'artistes appliqués sur un petit catalogue de supports, exploité depuis
Badalona par NEXTALIA VENTURES SL. Il vend un motif à un particulier ; nous vendons un
marquage à une entreprise.

---

## Ce que nous leur avons pris

**La grille de prix par quantité, publiée sur la fiche produit** (mistertee). Huit colonnes
de quantité par quatre lignes de faces, chaque cellule en prix unitaire. Un acheteur chiffre
trente pièces en deux faces sans parler à personne. C'est la meilleure idée du marché
français et `templates/teeshoop/product-price-grid.php` la reprend telle quelle.

**Le prix comprend l'impression.** « Tous nos prix incluent l'impression » (mistertee,
`/aide/prix`). Sur du personnalisé, annoncer le textile nu puis ajouter le marquage au
panier est la surprise classique. Notre grille dit « impression comprise » à chaque ligne.

**La dégressivité porte sur le panier entier, pas sur la ligne** (mistertee). Commercialement
juste et clairement expliqué chez eux ; c'est aussi ce que fait `Pricing`.

**Un bandeau de réassurance qui affirme des choses vérifiables** (mistertee) : « Imprimé en
France, dans nos ateliers au Mans », « Visuels vérifiés manuellement par nos graphistes ».
Quatre affirmations contrôlables valent mieux que quatre superlatifs.

**Des réalisations réelles et nommées** (mistertee) : « Polo McDo Champs-Élysées, broderie »,
« Merchandising du Festival Plein Champ, impression DTF ». Nous n'en avons aucune, donc la
page n'en invente pas : il n'y a pas de bloc « ils nous font confiance » sur ce site tant
qu'il n'y a personne à nommer. En France une fausse recommandation est aussi un délit.

**Une barre de catégories persistante** (mistertee) : quinze familles à un clic depuis
n'importe quelle page, ce qui met un vêtement à deux clics de l'accueil sans méga-menu.
Notre navigation fait la même chose avec les familles réellement remplies.

**Le devis garde le contexte** (mistertee) : « Demander un devis » depuis une fiche mène à
`/devis?product=642874`. Notre formulaire fait mieux, voir plus bas.

**Les avis négatifs restent en ligne** (mistertee). Nous n'avons pas encore d'avis ; quand
il y en aura, ce sera la règle.

---

## Ce que nous faisons délibérément autrement

### 1. Le « à partir de » est le prix que quelqu'un paie vraiment

Chez mistertee, le prix affiché en tête de fiche et sur chaque carte de listing est le prix
à **500 pièces**. Mesuré sur deux produits : le Sol's REGENT annonce 6,47 EUR TTC et coûte
15,97 EUR à l'unité (**2,47 fois plus**) ; le Stanley/Stella Creator 2.0 annonce 10,63 EUR
et coûte 23,11 EUR (**2,17 fois plus**). Le tri par prix trie sur ce chiffre-là.

`Pricing::headline()` lit ses deux ancres **dans la grille imprimée juste en dessous** et
publie la quantité qui atteint le prix, dans la même phrase : « 9,42 EUR HT l'unité dès
50 pièces ». Un acheteur de vingt pièces ne découvre pas l'écart en descendant la page.

### 2. Les dimensions d'impression sont publiées, en centimètres

**Aucun des deux ne publie une seule dimension d'impression.** Ce n'est pas une absence de
recherche, c'est un résultat :

- mistertee détient les zones en millimètres dans une charge utile JSON (`A3` 297 × 400 mm,
  `Coeur` 80 × 80, `Bandeau` 250 × 80, dos broderie 250 × 200, manches 80 × 80) et les
  chaînes `" mm"` et `"×"` apparaissent **zéro fois** dans le HTML que lit un client. Les
  zones sont nommées en jargon d'imprimeur : « A3 », « Anti-coeur », « Bandeau ».
- tostadora ne publie aucune dimension nulle part ; le seul chiffre en centimètres de tout
  le domaine est « 24 cm » de largeur maximale de fichier, dans un article d'aide.

Notre fiche produit publie la zone par face **en centimètres**, et l'accueil la dessine à
l'échelle à côté d'une feuille A4, parce que « 30,5 cm » ne dit rien et « plus large qu'une
feuille » dit tout. Les chiffres viennent de `data/garments.json`, généré depuis le studio,
donc ils ne peuvent pas diverger de ce à quoi la presse est réglée.

C'est notre différence de fond, et elle découle du modèle de prix : nous facturons la
surface d'encre, donc nous devons dire combien de surface il y a.

### 3. Les prix hors taxes existent

mistertee est **TTC uniquement** : zéro occurrence d'un prix HT sur l'accueil, une catégorie,
une fiche, `/professionnels`, `/devis`, `/aide/prix` et `/aide/livraison`, contre 37 « TTC »
sur la seule page catégorie. Le `<body>` porte pourtant la classe `tax_mode_ttc`, donc la
plateforme sait faire. tostadora affiche du TTC côté consommateur, du HT sur sa page
entreprises, et n'étiquette ni l'un ni l'autre : la mention est dans les CGU.

Un acheteur professionnel français lit du HT. `Settings::price_bases()` décide une fois pour
tout le site lequel mène et lequel suit, et sous le régime de franchise il n'y en a qu'un.

### 4. Le formulaire de devis demande ce qu'il faut demander

Le devis de mistertee est **un seul champ de texte libre** (`textarea name="project"`,
vingt caractères minimum) et un dépôt de fichier facultatif. Pas de quantité, pas de
produit, pas de date, pas de répartition des tailles, pas de société, pas un seul `select`.
La page doit ensuite expliquer en prose ce qu'il faut taper : « Références souhaitées /
Quantités par références / Techniques de marquage / Emplacements de marquage ».

Le nôtre part de ce que la page sait déjà (le vêtement, la quantité, les faces, la
répartition des tailles) et demande le reste en champs nommés, dont le SIRET, avec la
raison écrite à côté : « Il nous permet d'établir une facture hors taxes à votre nom. »

tostadora n'a **aucun** parcours de devis : sa page « Entreprises » mène au même éditeur
libre-service qu'un particulier, et sa FAQ répond « commandez dès 1 article ».

### 5. Les filtres sont des URL

Chez mistertee, **chaque lien de facette est du base64 dans un attribut `data-obf`** sur un
`<span>` sans `href`. Une liste filtrée ne peut ni être partagée, ni ouverte dans un nouvel
onglet, ni indexée. Les mêmes `<span>` portent aussi l'entrée de l'éditeur, « Demander un
devis », « Connexion » et « Panier » : quatre commandes qui ne sont pas focalisables au
clavier.

Nos facettes sont un formulaire GET. L'URL qui revient se colle dans un e-mail.

### 6. Il y a plus de facettes, et elles portent sur ce qu'un professionnel compare

mistertee en offre cinq (Gamme, Genre, Type de col, Manches, Marque) et sa facette Couleur
ne rend aucune option : les `<span>` sortent en `facetapi-zero-results facetapi-inactive`.
Il n'y a **ni taille, ni prix, ni grammage**. tostadora n'a aucune facette : dix pastilles
de thème, un arbre de catégories, une recherche plein texte, et 836 pages de 60 produits.

Nous en avons dix, dont le **grammage**, que le chapitre 04 place en troisième position et
qui est le premier chiffre qu'un acheteur d'entreprise compare. Cinq facettes du chapitre
sont absentes et le panneau les nomme à l'écran plutôt que de les cacher : la
disponibilité, le prix du textile nu, le délai, la technique de marquage et le secteur
d'activité.

### 6 bis. La facette Couleur, regardée de près chez cinq sites

C'est la facette qui décide d'un catalogue de vêtements, et c'est celle sur laquelle nous
avons passé le plus de temps. Cinq sites ont été ouverts dans un navigateur réel et mesurés,
le 20 août 2026.

**mistertee.fr.** Onze pastilles rondes de 24 px, une palette **fixe** dont les onze
hexadécimaux sont identiques à l'octet près sur les cinq catégories testées : elle ne
s'adapte jamais au rayon. Aucun nom, nulle part : mesuré sur le DOM rendu, onze `<li>`, zéro
`title`, zéro `aria-*`, zéro `alt`, et `innerText` vide sur chacun. Aucun élément focalisable
dans la facette, donc **inatteignable au clavier**. La pastille blanche est
`rgb(255,255,255)` sur une page blanche avec une bordure `rgb(224,231,238)`, soit **1,25:1**
là où WCAG 1.4.11 demande 3:1 : l'option « blanc » est invisible.

Et surtout : **elle ne filtre pas.** Mesuré avec un témoin, sur la même page, quatre
encodages différents de la facette couleur rendent 36 produits et le même premier résultat,
exactement comme la requête sans filtre ; la facette « manches », elle, descend à 11. Le
regroupement par familles existe pourtant dans leurs données, et il est fait à la main : leur
groupe « noir » contient « Chocolat », leur groupe « bleu » contient « Émeraude » et « Bleu
canard », leur groupe 9771 s'affiche en bleu saturé et ne contient que « Corde » et « Terre »,
et « Écru » n'appartient à aucun groupe, donc aucun filtre par famille ne peut l'atteindre.

**tostadora.fr.** Aucune facette couleur, ni repliée ni cachée. C'est cohérent avec leur
métier plutôt qu'un défaut : ils vendent le motif d'un artiste et le vêtement se configure
après.

**stanleystella.com.** Liste plate de 92 noms fabricant, sans familles. L'ordre **est** le
regroupement : ni alphabétique ni aléatoire, il suit le cercle des teintes, en-têtes en
moins. Leur pastille est un **recadrage photo** et non un aplat (mesuré : 714 couleurs
distinctes dans une pastille de 120 px), donc les chinés et les délavés montrent leur
texture. C'est le meilleur balisage des cinq : vraie case à cocher, nom visible à côté, et
sélection montrée par une coche **en plus** de la couleur.

**bc-collection.eu.** La réponse à deux niveaux, la plus proche de la nôtre : **onze
familles** (White, Black, Grey, Blue, Red, Green, Brown, Yellow, Orange, Pink, Purple), une
ligne de raccourci « Best sellers », et l'ouverture d'une famille révèle les noms fabricant
avec leur code (Blue en compte 22, de « Blue Fog 457 » à « Lake Blue 431 »), les bicolores
recevant un cercle coupé en deux. Deux manques : le bouton de famille n'a pas
d'`aria-pressed`, donc la sélection est invisible pour un lecteur d'écran, et le chevron qui
déplie est un `<div>` sans rôle ni `tabindex`, donc **le second niveau est inatteignable au
clavier**.

**falk-ross.eu**, qui est notre propre fournisseur, appelle la facette « Colour group » et en
offre **dix-neuf**. Chaque groupe est un vrai chemin (`/en/Products/T-Shirts/Blue/`), donc
partageable et indexable. Sa pastille blanche a une bordure à **21:1**, à comparer au 1,25:1
de mistertee.

**Ce que nous en avons tiré.** La structure de B&C, qui est la bonne : onze familles, et les
noms fabricant dessous, sans en fusionner un seul. Le nom visible à côté de chaque pastille
de Stanley/Stella, qui est ce que WCAG 1.4.1 demande et ce que mistertee n'a pas. Le fait que
le groupe soit une URL, de Falk&Ross. Et deux choses que personne ne fait :

- **Les familles sont mesurées, pas saisies.** C'est la leçon de mistertee : une table écrite
  à la main dérive, et « Chocolat » finit dans les noirs. Chez nous la famille se déduit de la
  couleur mesurée, jamais du mot, donc « Fan Deep Royal » tombe dans les bleus sans que
  personne n'ait à apprendre à la machine que « fan » ne veut rien dire.
- **Le clavier depuis le début.** Nos groupes sont des `<details>`, ce qui les rend
  ouvrables à la souris, au clavier et sans script, et annonce leur état à un lecteur d'écran
  sans une ligne d'ARIA. B&C et mistertee échouent tous les deux sur ce point.

### 7. La disponibilité est dite

mistertee ne dit **rien** : ni « en stock », ni « rupture », ni délai de réapprovisionnement.
Le seul signal est `"availability":"https://schema.org/InStock"` dans le JSON-LD, que
personne ne lit. La disponibilité par taille existe pourtant dans leurs données
(`"sizes":[{"name":"XXS","disabled":false}]`) et n'est jamais affichée.

Nous disons trois phrases, jamais un chiffre : « Disponible », « Rupture, nous consulter »,
« Délai à confirmer ». La troisième est celle que personne ne pense à construire, et c'est
la réponse honnête quand le relevé a plus de vingt-quatre heures.

### 8. Le prix d'achat ne sort pas

La page `/studio?p=...` de mistertee publie **son moteur de prix complet** dans sa charge
utile : `"purchase_price":365` (3,65 EUR le textile nu), les multiplicateurs 2,4 à l'unité
et 1,4 à partir de 500, et le prix d'impression 10,50 EUR par face tombant à 3,75 EUR. Les
huit cellules publiées de leur grille ont été reproduites au centime depuis ces valeurs.

`Shelf::SEALED` ferme cette porte chez nous, et `npm run verify:wp-catalogue` le prouve en
retirant le verrou et en exigeant que le contrôle trouve la fuite.

### 9. Pas de code promotionnel

tostadora fait ses paliers de quantité avec des **codes promo** (`PERSONNALISE15`,
`PERSONNALISE20`, `PERSONNALISE30`), à saisir soi-même à la commande, non cumulables. Un
acheteur qui ne connaît pas le code paie le prix fort.

Les coupons sont désactivés boutique-wide (`Checkout.php`) et la remise de quantité est
**dans le prix unitaire**, appliquée par le serveur. Il n'y a rien à connaître.

---

## Ce qu'ils font et que nous n'avons pas

Écrit ici pour que ce soit une décision et pas un oubli.

| Chez eux | Chez nous | Pourquoi |
|---|---|---|
| Date de livraison calculée (« Livraison estimée le 27 août ») | Un délai de fabrication en jours ouvrés, à partir du bon à tirer validé | La séance 07 a mesuré 6 jours ouvrés de travail incompressible dans une promesse d'urgence de 4. Nous ne publions que le délai standard, celui qui a de la marge. Une date de livraison exige un transporteur mesuré, ce qui est la séance 13. |
| Avis clients vérifiés, notes par produit | Rien | Nous n'avons aucun client à citer. Un avis inventé est un délit en France. |
| Un comparateur de 3 ou 4 produits | Rien | Demandé par le chapitre 04. Pas construit cette séance. |
| Des packs sectoriels configurables | Rien | Demandés par le chapitre 00 (six packs). Pas construits cette séance. |
| Recherche avec synonymes (« polo chantier ») | La recherche WordPress, mot exact | Demandée par le chapitre 04. Notre page de résultats vides le dit au visiteur au lieu de faire semblant. |
| Broderie, flocage, sérigraphie présentés et vendus | DTF seul | Question 12. Aucune autre technique n'a de modèle de coût, donc aucune n'est chiffrable. |
| Un studio avec génération d'images par IA | Rien | Hors sujet pour un acheteur qui arrive avec son logo. |

---

## Une chose que nous ne copierons pas

mistertee publie **deux tables de prix qui ne concordent pas** : celle de la fiche produit
(REGENT, 1 face : 15,97 → 6,47 EUR) et celle de `/aide/prix` (16,03 → 4,74 EUR), la seconde
avec l'avertissement « Prix en vigueur au moment de la rédaction de cet article ». C'est
l'aveu qu'il existe deux sources de vérité pour un prix.

Sur ce site il y en a une, `Pricing`, et les tests l'exigent cellule par cellule.
