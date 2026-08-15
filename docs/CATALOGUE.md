# Le catalogue : d'où il vient, comment il se rafraîchit

État au 14 août 2026. Ce document dit **comment le catalogue arrive dans la boutique**,
**à quelle fréquence il doit être rafraîchi** et **ce qu'il coûte**. Les décisions de
modélisation sont argumentées dans l'en-tête de
`wp-plugins/teeshoop-core/includes/Catalogue.php` ; ici, c'est l'exploitation.

---

## Le chemin

```
fournisseur  ->  Worker Cloudflare  ->  WordPress
   XML/CSV        /api/fr/*            wp teeshoop catalogue importer
```

La boutique **ne parle jamais au fournisseur**. Elle appelle notre propre Worker, qui
détient les identifiants, lit le XML et le CSV du fournisseur et rend du JSON compact.
Ce n'est pas une préférence : l'analyseur du Worker encode une douzaine d'endroits où la
documentation du fournisseur et ses réponses réelles se contredisent, tous trouvés en
tapant sur le compte réel. Un second analyseur en PHP serait une seconde série de ces
décisions, et il divergerait.

Une référence = **un appel** : `GET /api/fr/catalogue/{style}` renvoie la fiche, nos
tarifs d'achat et le stock ensemble. Séparément, une passe complète ferait 1 389
aller-retours HTTPS depuis o2switch au lieu de 463.

### Ce qu'il faut pour que ça marche

| Élément | Où | Sans lui |
|---|---|---|
| `TEESHOOP_CATALOGUE_TOKEN` | `wp-config.php`, **jamais** en base | L'import refuse et le dit |
| Adresse du Worker | réglage `worker_url` de l'extension | L'import refuse et le dit |
| `ADMIN_TOKEN` | secret du Worker | Le Worker répond 401 à tout |

Le jeton est une **constante** et pas une option : les options partent dans toutes les
sauvegardes, dans toutes les migrations, et s'éditent depuis l'administration. Celui-ci
ouvre une route qui renvoie nos prix d'achat sur tout le catalogue.

---

## Les commandes

```bash
wp teeshoop catalogue importer                  # tout, jusqu'au bout
wp teeshoop catalogue importer --duree=1800     # 30 minutes puis on s'arrête proprement
wp teeshoop catalogue importer --max=5          # test de fumée
wp teeshoop catalogue importer --recommencer    # oublier la passe en cours et relister
wp teeshoop catalogue etat                      # où en est la passe
wp teeshoop catalogue purger                    # tout retirer (miroir local uniquement)
```

Un seul import à la fois : le second refuse et le dit. Le verrou est tenu par la
**connexion** MySQL, donc un processus tué le relâche tout seul. Une exception sur le
miroir local : `docker compose run` peut laisser le conteneur vivant alors que la commande
côté hôte est morte, et la connexion avec lui. Si l'import refuse de démarrer alors que
rien ne tourne :

```bash
docker ps | grep wpcli          # le conteneur orphelin
docker rm -f <son nom>          # le verrou part avec sa connexion
wp db query "SELECT IS_USED_LOCK('teeshoop_catalogue_import');"   # NULL = libre
```

**Une sauvegarde ne se pose jamais dans `wp-content/uploads`.** Ce répertoire est servi par
URL : un `wp db export` posé là est un dump complet de la base téléchargeable par n'importe
qui. Constaté pendant cette séance, en HTTP 200 sur 58 Mo. `wp db export ~/dump.sql`, en
dehors de la racine web, et supprimé après.

L'import est **idempotent** et **reprenable**. Relancé sans rien de changé en amont, il
n'écrit rien et l'annonce. Interrompu, il perd au plus la référence en cours : la passe
suivante repart au même index. C'est ce qui fait de `--duree` un créneau de cron utilisable
plutôt qu'un travail qu'il faut surveiller.

Idempotent **par comparaison, pas par empreinte** : chaque champ est relu et comparé avant
d'écrire. Une empreinte ne vaut que ce que vaut la liste des champs qu'on y a mis, et le
jour où quelqu'un ajoute un champ sans toucher à l'empreinte, l'import annonce « rien
changé » pour toujours pendant que la boutique dérive.

---

## La fréquence

| Passe | Rythme | Pourquoi |
|---|---|---|
| Catalogue complet | **une fois par nuit** | Le fournisseur réexporte tous les matins ; la fiche, les coloris et les tailles bougent rarement, le stock bouge tous les jours |
| Relance après échec | le créneau suivant | La passe reprend là où elle s'est arrêtée, il n'y a rien à faire à la main |

Ligne de crontab, sur o2switch (le cron serveur existe, vérifié le 14/08) :

```cron
17 3 * * *  cd ~/public_html && /usr/local/bin/wp teeshoop catalogue importer --duree=3600 --discret >> ~/logs/catalogue.log 2>&1
47 4 * * *  cd ~/public_html && /usr/local/bin/wp teeshoop catalogue importer --duree=1800 --discret >> ~/logs/catalogue.log 2>&1
```

Deux créneaux, pas un : le premier fait le gros, le second finit ce qui reste si la nuit a
été lente. Un créneau qui n'a rien à faire se termine en quelques secondes et écrit une
ligne.

**Ne pas utiliser WP-Cron.** Il ne se déclenche qu'à la visite d'une page, donc sur une
boutique calme il ne se déclenche pas, et il partage le temps d'exécution du visiteur.

---

## Ce que ça coûte

Mesuré le 14 août 2026 sur le catalogue réel.

| | |
|---|---|
| Références importables (t-shirts, polos, sweats) | **463** |
| Articles réellement vendus par le fournisseur | **26 399** |
| Combinaisons coloris × taille qui n'existent pas | **3 481**, soit 11,6 % du produit cartésien |
| Articles par référence | médiane 36, p90 134, p99 292, maximum 366 |
| Références de plus de 30 articles | 256 |
| Photos de face et de dos copiées | **734** (mesuré, pas estimé), environ 46 Mo avant les vignettes |
| Photos par coloris **non** copiées | 4 241, soit 267 Mo, ~650 Mo et 34 000 fichiers après redimensionnement |

**Les passes, mesurées** (miroir local) :

| Passe | Résultat | Durée |
|---|---|---|
| 1re, catalogue vide | 452 créées, 26 127 articles, 731 photos, 5 en échec | **1 h 37** (0,22 s par article) |
| 2e, après correction des codes-barres | 3 créées, 169 modifiées, 289 inchangées, 0 en échec | 10 min |
| 3e, rien n'ayant bougé en amont | **0 créée, 2 modifiées, 459 inchangées**, 3 articles écrits, 0 photo | **3 min** |
| 4e, après le changement de référence publique | 8 créées, 446 modifiées, 26 028 articles réécrits, 0 en échec, 2 dépubliées | 19 min |
| 5e, après suppression des 736 photos mal nommées | 0 créée, 459 modifiées, **734 photos recopiées**, 0 en échec | 11 min |
| 6e, catalogue reconstruit de zéro (photos déjà sur le disque) | 453 créées, 6 modifiées, 26 392 articles, **0 photo recopiée**, 0 en échec | 43 min |
| 7e, juste après | **0 créée, 4 modifiées, 455 inchangées**, 7 articles écrits | **2 min 35** |

La troisième est la preuve de l'idempotence : 26 399 articles relus, trois écritures, et
« Rien n'a changé » imprimé pour de bon. La quatrième montre le coût d'un changement de
référence, qui touche tout : vingt minutes. La cinquième est le prix d'une migration de
données : recopier toutes les photos coûte onze minutes, et c'est le vrai coût d'un
correctif qui ne s'applique qu'aux téléchargements suivants. La sixième vérifie que le renommage n'a
pas cassé la clé d'idempotence des photos : catalogue reconstruit entièrement, **zéro
photo retéléchargée**. La septième est la preuve d'idempotence refaite sur la boutique
livrée : 26 392 articles relus, sept écritures, et les quatre fiches modifiées sont des
mouvements de stock réels survenus entre les deux passes.

**Ce que la boutique pèse ensuite**, mesuré une fois le catalogue en place :

| | |
|---|---|
| Produits publiés | **462** : 459 références importées + les 3 produits personnalisables du studio |
| Références importables non publiées | 2 dépubliées (57442, 58842, retirées du listing fournisseur) + 2 sans aucun article (50001, 50101) |
| Articles | **26 392** |
| Prix d'achat stockés | **26 392**, soit tous |
| Pièces jointes | 735 (734 photos + le visuel par défaut de WooCommerce) |
| Lignes `postmeta` | 698 472 |
| Relations de termes | 13 699 |
| Termes | 615 (442 coloris, 95 tailles, 21 marques, 17 certifications) |
| Base de données | **172 Mo** |
| Fourchette de prix, produit le plus lourd (366 articles) | 309 ms à froid, **0,10 ms à chaud** |
| Idem sur les cinq plus lourds (292 à 366 articles) | 261 à 316 ms à froid, 0,07 à 0,17 ms à chaud |

### La page la plus lente n'est pas celle qu'on croit

Mesuré en HTTP sur la boutique livrée, trois passages chacun :

| Page | Temps |
|---|---|
| Fiche produit la plus lourde (366 articles) | 0,9 à 1,1 s |
| Archive boutique et page de catégorie | **1,6 s** |

Ce n'est donc pas la fiche à 366 articles que le brief redoutait : c'est la **liste**. En
isolant, sur seize produits :

| | |
|---|---|
| La requête de l'archive | 8,6 ms |
| Le prix affiché des 16 produits | **378 ms**, soit 23,6 ms par produit |

`get_price_html()` sur un produit variable relit la fourchette de prix de chacun de ses
articles. Seize produits variables sur une page, c'est seize parcours. Et aujourd'hui ces
378 ms produisent **une chaîne vide** : tant que le taux de marge n'est pas décidé
(question 42), aucun prix de vente n'est écrit. La boutique paie donc le calcul complet
pour n'afficher rien.

Deux façons d'en sortir, à décider avec le prix de vente et pas avant : ne pas afficher de
prix en liste tant qu'il n'y en a pas, ou stocker la fourchette sur le produit parent au
moment de l'import (elle y est déjà calculée et mise en cache : c'est la même donnée, lue
au lieu d'être recalculée).

Les relations de termes sont bien 13 699 et non ~55 000 : une **variation** ne porte aucun
terme, WooCommerce range son coloris et sa taille en meta (`attribute_pa_couleur`) et ne
rattache à la taxonomie que le produit parent. Le coût suit donc le nombre de produits, pas
celui des articles.

Le rayonnage obtenu, sans intervention :

```
T-shirts  186  > Manches courtes 141 · Manches longues 25 · Sans manches 8
Polos     107  > Manches courtes  91 · Manches longues 14
Sweats    168
```

Les variations sont construites depuis **la liste d'articles du fournisseur**, jamais
depuis le produit cartésien coloris × taille. Le style 15009 affiche 49 coloris et
9 tailles mais ne vend que 334 articles : les 107 autres n'existent pas, et les publier
reviendrait à encaisser des commandes que personne ne peut honorer.

### Le piège mesuré : la référence publique redonnait la clé qu'on scellait

La référence affichée était `{numéro de style}-{code coloris}-{taille}`, par exemple
`00142-000-XS`, et le numéro d'article du fournisseur que `Shelf.php` masque partout est
`{numéro de style}{code coloris}{un chiffre}`, soit `001420000`. Autrement dit la boutique
publiait, sur chaque fiche et dans l'API Store publique, **toute la clé d'approvisionnement
à un chiffre près**. Pire : la correspondance taille vers chiffre est identique pour tous les
coloris d'un style, donc un seul article confirmé ouvrait les 366 autres. Le numéro de style
seul était même affiché tel quel comme référence du produit parent.

Le contrôle de fuite ne voyait rien : il cherchait le littéral à neuf chiffres, et
`001420000` n'est pas une sous-chaîne de `00142-000-XS`.

La référence publique est désormais **le code article du fabricant** (E150, 64000,
61-212-0), qui est aussi ce qu'un acheteur de textile nu cherche vraiment. Mesuré : les 463
styles en publient un, aucun ne contient le numéro du fournisseur, et une seule paire
marque + code est partagée par deux styles, que l'import départage contre la base. Le
contrôle cherche maintenant aussi le numéro de style, donc la fuite ne peut pas revenir.

### Ce qui reste ouvert : le nom de fichier des photos

Le fournisseur nomme ses photos `180_09_344_m-2023_01.jpg` : **style 18009, coloris 344**,
soit les deux champs dont son numéro d'article est fait. Deux surfaces les exposaient :

- **Les photos copiées** dans WordPress atterrissaient dans `wp-content/uploads` sous ce
  nom. **Corrigé** : le fichier est renommé à l'entrée avec le code du fabricant
  (`PU415.jpg`, `PU415-dos.jpg`). Le nom d'origine reste la clé d'idempotence en meta, donc
  une nouvelle prise de vue se retéléchargera toujours et une photo inchangée jamais.

  **Corriger le code n'a pas corrigé la boutique**, et c'est la partie qu'il faut retenir.
  Les 736 photos déjà copiées gardaient leur ancien nom : `attachment()` les retrouve par
  leur clé d'idempotence et ressort avant de télécharger, donc aucune passe, si idempotente
  soit-elle, ne pouvait les renommer. Elles ont été supprimées et réimportées à la main.
  Une migration de données n'est pas incluse dans un correctif de code, et le contrôle
  vérifie désormais le **résultat** (aucune pièce jointe ne porte ce motif) plutôt que
  l'intention.

- **Les photos par coloris**, elles, ne sont pas copiées : leur URL est relayée telle quelle
  par le Worker (`/media/blank/picture/001_42_000_f-2020_01.jpg`) et rendue dans la fiche.
  **Ce point n'est pas corrigé**, et le choix appartient à l'associé parce qu'il a un prix :

  | Option | Coût mesuré | Effet |
  |---|---|---|
  | Copier aussi les 4 241 photos par coloris | 267 Mo, ~1 h 30 d'import, et le nom devient le nôtre | Ferme la porte, supprime aussi la dépendance à une adresse de Worker publique |
  | Retirer le changement de photo au coloris | gratuit | Ferme la porte, mais 49 coloris affichent la même photo |
  | Ne rien faire | gratuit | Un visiteur qui inspecte une image voit un nom de fichier fournisseur |

  La fuite est plus faible que celle de la référence (il faut déjà savoir à quel grossiste
  cette convention appartient), mais elle est de la même famille et elle est écrite ici
  plutôt que découverte plus tard.

  En attendant la décision, la porte est **épinglée à sa largeur exacte** : le contrôle
  exige que ce motif n'apparaisse sur une surface client qu'à l'intérieur d'une URL
  `/media/blank/`. Un gabarit qui l'écrirait ailleurs, demain, échoue. C'est la différence
  entre une exception décidée et une exception qui s'élargit toute seule.

### Le piège mesuré : le fournisseur se nomme dans nos fiches produit

Sur les styles en fin de série, le fournisseur écrit ses propres annonces de stock dans la
description : « CLOSE-OUT: ce style est retiré de la collection *notre fournisseur* ».
Deux fiches produit le publiaient en clair. Le garde-fou `php-guard` ne pouvait pas le voir :
il lit les fichiers du dépôt, et cette chaîne n'a jamais existé que dans `wp_posts`.

Ces puces sont retirées à l'import, **par leur marqueur et non par le nom** : sur les 463
styles, les deux seules lignes qui commencent par une étiquette en capitales suivie de deux
points sont exactement ces deux annonces. Écrire le nom du fournisseur dans le code pour le
filtrer aurait été le mettre là où justement il ne doit pas être, et aurait raté la
prochaine note. Le fait lui-même n'est pas perdu : la fin de série arrive article par article
et est stockée sur la variation.

### Le piège mesuré : un code-barres en double coûtait toute une référence

WooCommerce 9.2 a promu le code-barres (`_global_unique_id`) au rang de propriété et fait
**lever une exception** quand la valeur est déjà portée par un autre produit. Les données du
fournisseur en contiennent : **4 codes-barres sur les 21 479 du catalogue** sont utilisés par
plus d'un article, dont `4053840000000`, un code de remplissage manifeste partagé par quatre
articles du style 12639.

Le premier import complet a donc **perdu trois références entières** (10154, 12154, 12639),
soit plusieurs centaines de vêtements vendables absents de la boutique parce que deux
d'entre eux partagent un numéro que personne ne lit. Le code-barres est écrit à part
désormais : un refus coûte le code-barres, pas le vêtement, et le compte des refus est
remonté dans le rapport de passe. Une collision de **référence** (SKU) continue, elle, de
faire échouer l'import : deux produits qui revendiquent la même référence, c'est un vrai
conflit.

### Le piège mesuré : la file d'Action Scheduler

Chaque enregistrement de variation fait programmer à WooCommerce une action
`woocommerce_run_product_attribute_lookup_update_callback`. Sur le miroir local, qui ne
reçoit aucune visite, **6 998 actions se sont accumulées** au fil des passes d'import, et
comme l'insertion vérifie d'abord qu'il n'y a pas de doublon en attente, chaque
enregistrement devenait plus lent que le précédent : mesuré, 0,24 s par variation sur une
base propre contre 4 à 7 s une fois la file remplie.

Action Scheduler ne se vide qu'à la faveur d'une requête HTTP (25 actions par lot). En
production, le trafic s'en charge. Sur une boutique calme, ou sur une préproduction, non :
après un premier import complet il y a 26 399 actions en attente, et il faut environ mille
requêtes pour les écouler.

**À surveiller après la première mise en ligne** (séance 13, supervision) :

```bash
wp db query "SELECT status, COUNT(*) FROM wp_actionscheduler_actions GROUP BY status;"
wp action-scheduler run --batch=100   # si la file ne descend pas toute seule
```

### Les images

Copiées dans WordPress : **la face et le dos**. Il faut de vraies pièces jointes parce que
la boutique, le panier, l'e-mail de commande et les données structurées adressent une image
par son identifiant.

Laissées sur le Worker : **les 4 241 photos par coloris**. Une à trois heures de
téléchargement sur un hébergement mutualisé pour changer une image quand un client choisit
une couleur, contre zéro octet et zéro seconde en les servant depuis le cache de
Cloudflare avec un en-tête immuable de trente jours. L'URL est posée sur la variation et
injectée dans le JSON des variations, donc la photo change quand même avec le coloris.

Ce qui ferait changer d'avis : un fournisseur qui recommence à photographier ses gammes
(une copie devient périmée sans que rien ne le dise, une image relayée non), ou le besoin
d'avoir ces photos dans Google Images, qui exige des pièces jointes.

---

## Le prix d'achat

Il est posé sur la variation, dans une meta privée, et il ne sort par aucune porte :
l'API REST authentifiée (produits **et** variations), l'API Store publique, l'export CSV
avec les meta personnalisées cochées, le JSON des variations envoyé au navigateur, et
l'affichage des meta de ligne de commande. Le préfixe souligné n'est pas la protection :
il masque la meta dans l'éditeur de produit et nulle part ailleurs.

`npm run verify:wp-catalogue` le vérifie en cherchant le nombre dans chacune de ces
sorties, **et** en prouvant d'abord que le nombre est bien en base, **et** en retirant le
verrou pour exiger que le même contrôle trouve la fuite. Un contrôle qui n'a jamais
déclenché n'est pas un contrôle.

Le numéro d'article du fournisseur est protégé de la même façon, pour une autre raison :
c'est une empreinte de qui nous fournit, et il suffit de le coller dans un moteur de
recherche.

---

## Le prix de vente

**Il n'y en a pas, tant que personne n'a fixé le taux de marge.**

`blank_margin_rate` vaut `null` dans la configuration de prix. Tant qu'il vaut `null`,
l'import n'écrit aucun prix : les produits sont consultables et non commandables. La Bible
donne la formule (prix conseillé = coût / (1 − taux de marge cible), chapitre 1) et laisse
explicitement le taux à décider. À 40 %, un t-shirt acheté 3,37 € se vend 5,62 € ; à 60 %,
8,43 €. Rien dans ce dépôt ne peut dire lequel est le bon, donc rien dans ce dépôt ne le
choisit. **Question 42** de `QUESTIONS-ASSOCIE.md`.

Le jour où le taux est réglé, la passe suivante valorise chaque variation depuis son propre
prix d'achat. Aucune reprise manuelle.

**À régler avant de le fixer**, et ce n'est pas un détail d'affichage : le prix produit est
HT, et la boutique est réglée pour afficher hors taxes (c'est le bon choix pour les
acheteurs professionnels auxquels s'adressent les fiches personnalisables). Une référence
importée n'a aucun gabarit Teeshoop autour d'elle : elle afficherait donc du HT brut, et un
particulier découvrirait 20 % de plus au paiement. En France, un prix affiché à un
consommateur doit être TTC. La question 41 passe donc avant la 42 : si ces textiles nus sont
vendus à des particuliers, le catalogue a besoin d'un affichage TTC avant que ce taux ne
soit posé.

Ce taux n'est **pas** le même nombre que `garments[*].base_ht`, qui est ce qu'un textile nu
apporte à une ligne **personnalisée**. Les deux cohabitent aujourd'hui et la séance 05
(moteur de coût) est l'endroit où l'un des deux doit gagner.

---

## Ce qui n'est délibérément pas fait

**Les références importées ne sont pas personnalisables.** Elles ne portent pas
`_teeshoop_garment`. `Pricing` valorise la personnalisation depuis un `base_ht` par
vêtement, et un produit qui aurait à la fois ce `base_ht` et son propre prix d'achat aurait
deux prix de textile nu susceptibles de diverger. Rattacher le catalogue au studio est le
travail de la séance 05, et il faudra que l'un des deux l'emporte.

**Rien n'est retiré de la boutique sur la foi d'une liste incomplète.** Si la passe de
listage s'arrête en chemin, l'import le dit et ne dépublie rien : une référence qu'on n'a
pas vue n'est pas une référence disparue.

**Les articles retirés du catalogue partent à la corbeille, pas à la poubelle.** Une
variation peut être sur une commande non expédiée.

---

## Questions ouvertes

| # | Question | Effet si la réponse change |
|---|---|---|
| 42 | Le taux de marge sur un textile nu revendu | Le catalogue devient commandable |
| 43 | Que valent les trois nombres de stock du fournisseur | Aujourd'hui seul le premier est traité comme du stock disponible ; le troisième vaut trente fois plus |
| 44 | Faut-il traduire les 442 noms de coloris | Aujourd'hui ce sont les noms du fabricant, en anglais pour la plupart |
