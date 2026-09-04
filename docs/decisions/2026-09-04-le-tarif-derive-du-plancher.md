# 4 septembre 2026 : le tarif publié cesse d'être une figure de démonstration

Décision prise seule, la nuit, personne n'étant joignable. Elle porte sur un
chiffre que des clients paieront, elle est donc écrite en entier, avec la façon
de la refaire.

Tous les chiffres ci-dessous sortent de `wp-plugins/teeshoop-core/tests/integration-grille.php`
lancé contre le miroir docker, sur les neuf références réelles de la gamme de
lancement. Aucun n'est estimé.

---

## 1. Ce qui a été mesuré, et c'est pire que ce que le brief annonçait

Le brief de la nuit 2 citait la mesure du 2 septembre : cinquante pièces
1,81 EUR sous leur plancher, cinq pièces 3,69 EUR. Cette mesure était faite sur
un visuel de 288 cm² et sur un prix d'achat générique de 3,37 EUR.

Remesuré le 4 septembre **à la surface que la grille promet vraiment** (la borne
du premier palier, un carré de 25,0 cm de côté) et **au prix d'achat réel de
chaque référence, au coloris le plus cher** :

> **102 des 219 colonnes publiées se vendaient sous leur plancher**, de 1,71 EUR
> à 299,01 EUR la commande.

Toutes les colonnes t-shirt, sans exception. Le tableau complet est dans la
transcription de la séance.

### Les quatre choses qui manquaient à la mesure du 2 septembre

1. **La surface.** La grille annonce un prix « jusqu'à N cm² par face ». Un
   client peut commander exactement N. Un carré de 25 cm ne partage pas une
   feuille de 33 x 46 avec un autre : c'est une feuille par vêtement, contre une
   pour deux à 288 cm². Le film double.
2. **Le prix d'achat réel.** Avec `_teeshoop_blank_ref` posé sur les offres, le
   moteur lit l'article du fournisseur taille par taille au lieu d'un tarif
   générique. Le B&C #inspire E150 coûte 6,14 EUR en M là où le générique disait
   3,37.
3. **Le coloris.** Mesuré : 3,00 EUR le blanc contre 3,78 le noir sur le
   B&C #E150 en M, 26 % d'écart sur le plus gros poste. Le client choisit.
4. **Les faces.** La grille publie une ligne par nombre de faces imprimables,
   donc trois sur un t-shirt. Un contrôle qui ne regarde que la première face
   valide un tiers du tableau.

### Deux défauts trouvés en chemin, qui n'étaient pas le sujet

**Les offres n'avaient pas de poids.** WooCommerce porte le poids sur la
DÉCLINAISON ; le produit variable parent est vide, et l'offre le recopiait tel
quel. `Shipping` répondait « le poids d'un des articles n'est pas renseigné »,
donc **zéro euro de livraison dans le coût et zéro dans l'encaissé**, et le
plancher était calculé sans le port. L'offre porte maintenant le poids de sa
déclinaison la plus lourde : sur-peser fait refuser une commande qu'on aurait pu
expédier, sous-peser fait facturer un port sous son coût, et seule la première
erreur ne coûte pas d'argent.

**La grille publiait des prix pour des colis qu'on ne sait pas expédier.** Un
sweat dont la déclinaison la plus lourde pèse 0,7 kg affichait 20,80 EUR l'unité
à cinquante pièces, soit un colis de 35 kg, cinq de plus que la grille Colissimo
ne sait affranchir. Le client pouvait mettre la ligne au panier et arriver à une
caisse sans mode de livraison. `Shipping::max_pieces()` répond maintenant à la
question, `ProductPage::grid_rows()` marque ces colonnes « sur devis », et
l'accroche de tête (`Pricing::headline`) ne peut plus s'ancrer dessus.

---

## 2. Décision : remonter la grille, pas cesser de la publier

Le brief laisse deux options et interdit de reporter. Remonter, parce que
l'associé a répondu à la question 08 : « Oui, la grille tarifaire par quantité
peut être visible publiquement. » Retirer la grille irait contre sa réponse pour
résoudre un problème qui a une autre solution.

**Le chiffre n'est pas choisi, il est dérivé, et voici la règle :**

> Le tarif publié est le plus petit auquel **chaque** colonne publiée de
> `Pricing::grid()` atteint le plancher que `Costing` calcule pour elle, sur les
> vraies références, à la surface promise, au coloris le plus cher, arrondi à
> l'euro supérieur.

L'arrondi ne fabrique rien : il ne fait que s'éloigner du plancher. Sans lui la
solution exacte est 20,01 EUR le t-shirt, ce qui laisse dix-neuf centimes de
marge sur la colonne la plus tendue, et un garde qui vire au rouge sur dix-neuf
centimes est un garde qu'on finit par ignorer.

| | avant | après |
|---|---|---|
| T-shirt, une face, 5 pièces | 14,50 EUR | **21,00 EUR** |
| T-shirt, une face, 50 pièces | 9,42 EUR | **13,65 EUR** |
| Sweat, une face, 5 pièces | 32,00 EUR | **39,00 EUR** |
| Face supplémentaire | 6,00 EUR | **7,00 EUR** |
| Colonnes publiées sous leur plancher | **102 sur 219** | **0 sur 111** |
| Marge minimale au-dessus du plancher | −299,01 EUR | **+9,15 EUR** |

Le nombre de colonnes baisse de 219 à 111 parce qu'un prix plus haut franchit
plus tôt le seuil d'autonomie de 2 000 EUR HT, et parce que les colonnes de
sweats à cinquante pièces sont passées « sur devis » faute de tenir dans un
colis. Les deux sont des refus corrects, pas des pertes de couverture.

## 3. Pourquoi le plancher, et pas le prix conseillé

Trois cibles étaient dérivables. Elles ont toutes les trois été calculées, sur
les mêmes mesures :

| Cible | T-shirt, 5 pièces | T-shirt, 50 pièces |
|---|---|---|
| Plancher (contribution minimale 25 %) | **21,00 EUR** | **13,65 EUR** |
| Zone d'autonomie (conseillé moins 15 %) | 25,43 EUR | 16,53 EUR |
| Prix conseillé (marge brute 50 %) | 30,61 EUR | 19,90 EUR |

Les prix concurrents **mesurés** pour un t-shirt imprimé à l'unité
(`docs/CONCURRENTS.md`) : mistertee vend le Sol's REGENT 15,97 EUR et le
Stanley/Stella Creator 2.0 23,11 EUR, et son propre moteur de prix, publié dans
sa charge utile, donne 19,26 EUR (textile 3,65 x 2,4 + impression 10,50).

Seule la première des trois cibles tombe dans cette fourchette.

**Choisir l'une des deux autres serait un arbitrage de positionnement
commercial, qui appartient à l'associé. Refuser de vendre sous le coût est un
arbitrage d'ingénierie, qui est le nôtre.** C'est la ligne de partage, et c'est
la seule raison pour laquelle cette décision se prend sans lui.

### Ce que ça laisse ouvert, et c'est pour lui

Au plancher, la boutique garde **25 % du prix**, ce qui est l'hypothèse par
défaut de la question 06 que personne n'a confirmée. Il a nommé, le
1er septembre, « un objectif de marge brute minimale d'environ 50 % après coûts
directs ». L'écart entre les deux vaut **9,61 EUR par t-shirt à cinq pièces**.

La question part dans `QUESTIONS-ASSOCIE.md` avec les trois colonnes du tableau
ci-dessus, pour qu'il tranche sur des chiffres et pas sur un principe.

## 4. Ce que le tarif ne couvre pas, dit explicitement

**Le coût est incomplet et le plancher aussi.** Deux postes restent inconnus et
valent zéro dans le calcul : les consommables (question 05, jamais chronométrés)
et la provision de défaut (question 27, aucun taux de non-conformité connu). Le
vrai plancher est donc **plus haut** que celui qui est appliqué. Chaque ligne du
contrôle porte la mention *(incomplet)* pour cette raison.

**Le film est une borne haute.** Le service d'imbrication n'a pas répondu, donc
le marquage est chiffré « une bande par transfert, sans imbrication ». Sur des
carrés de 25 cm la borne est serrée (une pièce par feuille de toute façon), mais
elle ne l'est pas sur des visuels étroits.

**Le vêtement fourni par le client n'est pas mesuré.** Aucun produit de la gamme
ne permet à un client d'envoyer son propre textile, donc le contrôle n'a rien à
chiffrer. `garments.custom.first_side_ht` reste l'hypothèse qu'il était
(H-Q06-TARIF-VETEMENT-CLIENT). Seul son prix de face supplémentaire bouge, à
7,00 EUR, parce qu'une deuxième face est le même film et la même pose quel que
soit le vêtement.

**Une création découpée en plusieurs morceaux n'est pas couverte.** Le contrôle
mesure un carré unique à la borne du palier. La même surface en trois morceaux
coûte davantage en pose et s'imbrique autrement dans le film.

## 5. Le garde, et la preuve qu'il sait refuser

`npm run verify:grille` fait tourner **les deux moteurs réels** sur de vraies
commandes : `Pricing` pour ce que la page publie, `Costing` pour ce que la
commande coûte. Rien ne les faisait dialoguer avant, et c'est exactement pour ça
que la grille a pu dériver sous son plancher sans qu'aucun contrôle ne bouge.

Il refuse quatre choses : une colonne sous son plancher, une colonne sans
plancher calculable, une colonne dont le coût ignore le textile ou le port, et
une exécution qui n'a rien mesuré.

Il ne tourne pas dans `npm run ci` : il lui faut un vrai WordPress, une base et
le catalogue importé, comme `npm run test:wp`.

**Cassé exprès une fois**, le 4 septembre : `garments.tee.base_ht` ramené de
11,00 EUR à 4,00 EUR. Le garde a sorti le code 1 avec **74 refus nommés**
(« 01942 (tee) 1f x5 : encaissé 85,69 EUR, plancher 105,85 EUR, il manque
20,16 EUR »). Valeur restaurée, il est repassé à « 111 colonnes publiées, toutes
au-dessus de leur plancher ».
