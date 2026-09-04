# Nuit 2, ce qui reste à reprendre

> Écrite à la fermeture de la nuit du 4 septembre 2026. Tout chiffre ici a été
> produit en faisant tourner la chose réelle contre le miroir docker. Ce qui n'a
> pas été mesuré le dit.

---

## 1. L'état des lieux, avant et après

| | Avant | Après |
|---|---|---|
| Produits achetables | 9 | 9 |
| dont montages de harnais | **8** | **0** |
| dont offres réelles avec référence fournisseur | 0 | **9** |
| Colonnes publiées **sous leur plancher de coût** | **102 sur 219**, puis 34 de plus | **0 sur 111** |
| T-shirt, une face, 5 pièces | 14,50 EUR | **23,00 EUR** |
| T-shirt, une face, 50 pièces | 9,42 EUR | **14,95 EUR** |
| Sweat, une face, 5 pièces | 32,00 EUR | **49,00 EUR** |
| Refus « textile nu » du portail | **6** | **0** |
| Refus du portail, tous motifs | 23 | **17** |
| Sélecteurs de style pour panier, caisse, compte, commande reçue | **0** | 1 099 lignes |
| Paires (coloris, taille) proposées et inachetables | **10** | **0** sur 894 |
| `npm run test:wp` | 230 passées, 4 échouées | **235 passées** |

## 2. Ce qui n'est pas fini, nommément

### La zone d'impression : la méthode ne peut pas aboutir sur ces photographies

**Zéro référence porte une zone d'impression mesurée**, et c'est un constat, pas
un abandon. La machinerie est construite (`npm run zones:mesurer`, qui fait
tourner le vrai code du studio dans un vrai navigateur), elle a été lancée sur
les dix-huit photographies de la gamme, et elle les a refusées une par une :
sept parce que le torse occupe 85 à 99 % de la silhouette, sept parce que la
ligne de col n'est pas trouvée, quatre parce que le détourage ne rend pas une
forme de vêtement.

La cause de fond est que **les photographies de face du fournisseur sont des
mannequins vivants** (celle du B&C ID.333 en porte deux), et que les vues de
dos, qui sont bien à plat, n'ont pas d'encolure creusée à mesurer.

Ce que ce travail a intercepté au passage : avant le contrôle de vraisemblance,
le B&C ID.333 était « mesuré » à 47,5 x 48,6 cm, une encolure trouvée **entre
les deux mannequins**, et ce rectangle serait parti chez l'imprimeur.

Trois chemins, du moins cher au plus cher, dans
`docs/decisions/2026-09-04-zone-impression-mesuree.md` et `ACCES-REQUIS.md` §12.
Le moins cher est une question au fournisseur : a-t-il des vues à plat manches
écartées ? Le Fruit of the Loom Valueweight en a une, et c'est la seule des neuf.

### Ce qui n'est pas personnalisable, et pourquoi

**Polos (104 références), chemises (100) et les 1 718 « autres textiles »** ne
sont pas dans la gamme. Le champ `_teeshoop_garment` ne décide pas seulement
d'un prix, il décide de ce que l'éditeur **dessine**, et le studio ne connaît que
`tee` et `hoodie`. Un polo rendu en col rond est un visuel fabriqué. Les sweats
à col rond sont dehors pour la même raison : le dessin `hoodie` a une capuche.

Le chemin qui les ouvre existe à moitié (`CustomGarment` sait décorer une
photographie), et ce qui manque est la remise de ce vêtement photographique de
la boutique vers le studio. C'est le poste que le brief annonce comme « plus
gros que la réécriture du personnalisateur », et il n'a pas été fait.

### Deux défauts de géométrie trouvés par la passe adversariale et NON corrigés

**Le gradient d'impression utilise la charte d'un dixième vêtement.** L'offre
déclare `garment = 'tee'`, donc `printScaleK` lit la charte du studio
(Stanley/Stella Creator STTU755) pour grader le visuel sur neuf vêtements
d'autres fabricants. Mesuré sur le Gildan Heavy Cotton, dont la vraie série est
maintenant sur le produit : la part de la poitrine qu'occupe le marquage est de
0,629 en S contre 0,528 en 3XL, soit **19 % de plus en S**, là où elle est plate
sur le vêtement dont la charte vient. Le même fichier, la même commande, un
rendu visiblement différent selon la taille.
Le correctif est de faire traverser `_teeshoop_demi_poitrine` vers le studio et
de le donner à `printScaleK`, qui accepte déjà une charte par création
(`design.custom.halfChestCmBySize`). Ce n'est pas une correction de seuil.

**La grille publie six colonnes que le panier refuse au marquage maximal.**
`grid_rows()` décide « sur devis » à partir d'un prix calculé au palier de
surface standard ; `Cart::add` décide sur le total réel de la ligne. À la plus
grande surface imprimable, deux faces x cent pièces sur les six t-shirts
franchissent les 2 000 EUR HT et sont refusées. Bonne nouvelle mesurée dans la
même passe : à cette surface, **aucune colonne ne passe sous son plancher**.

### La TVA n'est toujours pas tranchée, et ce n'est pas à nous

`H-Q17-TVA` ne porte aucune date de réponse, et quinze commandes réelles ont été
encaissées avec le calcul des taxes désactivé. Le portail refuse la mise en ligne
pour cette raison, et il a raison. C'est de l'argent et du droit qui sortent de
l'entreprise : ça appartient au développeur et à l'associé.
`ACCES-REQUIS.md` et `QUESTIONS-ASSOCIE.md` le portent.

### Trois questions attendent l'associé

`QUESTIONS-ASSOCIE.md` Q64 (le tarif : gardons-nous le plancher, montons-nous à
la marge de 50 % qu'il a nommée, la remise de quantité est-elle la sienne, et
faut-il un supplément sur les grandes tailles plutôt que faire payer à un S ce
que coûte un 3XL), plus Q62 et Q63 de la nuit 1 qui n'ont pas bougé.

## 3. Ce qui a été trouvé en chemin et qui n'était pas le sujet

**Un verrou de migration testé sur une porte murée.** `integration-schema.php`
posait le verrou avec `set_transient( 'teeshoop_schema_lock' )` pendant que
`Schema::migrate` lisait l'option `teeshoop_schema_lock`, depuis que ce verrou
est passé à `add_option()` pour être atomique. Deux noms, aucune rencontre : le
test posait un verrou que rien ne tenait et vérifiait qu'une migration s'y
arrêtait.

**Deux comparaisons d'argent en flottants** qui ne marchaient que tant que le
tarif portait des centimes. `2100 / 100` vaut `int(21)` en PHP et
`21.0 !== 21` sous une comparaison stricte. Neuf comparaisons converties en
centimes via `Money::from_eur`.

**Le panier en blocs rend un squelette** avec les mêmes classes que le panier
plein, et `networkidle` est atteint à ce moment-là. La première capture livrait
un panier entièrement gris comme preuve que le panier est habillé.

**La caisse installée est celle en BLOCS**, pas les raccourcis classiques ;
« Mon compte » est resté classique. Les deux sont habillées.

## 4. Les gardes ajoutés, et la façon de les casser

| Garde | Ce qu'il refuse | Prouvé en cassant |
|---|---|---|
| `npm run verify:grille` | une colonne publiée sous son plancher, une colonne sans plancher calculable, un coût amputé du textile ou du port, une exécution qui n'a rien mesuré | `base_ht` 13,00 -> 6,00 : code 1, **80 refus nommés**, puis retour à « 111 colonnes, toutes au-dessus » |
| `npm run zones:mesurer` | une fiche de mesures illisible, hors unité, non croissante ou incomplète ; une photo sans silhouette ; un col non trouvé ; un torse qui occupe plus des trois quarts de la boîte | les dix-huit photographies de la gamme, chacune avec sa raison |
| `npm run verify:achat` | un panier vide, une caisse sans récapitulatif, un débordement latéral à 375 px, un courriel sans le navy ou avec une propriété personnalisée, **un total de caisse différent de celui du panier** | 32 assertions |
| `hypotheses-guard --self-test` | trois cas de plus : `answered` et `decided_by` ensemble, une décision sans date, une décision signée « associe » | 14 cas, tous FIRED |

**Le garde du plancher n'est dans aucun job de CI**, comme `test:wp` : il lui
faut un vrai WordPress, une base et le catalogue importé. Il doit être lancé à
la main avant toute mise en ligne. Il a aussi un mode `json` positionnel qui
sort en 0 avant les refus, pour permettre de re-dériver le tarif : ne le câblez
pas dans un job, il rendrait le garde vert en permanence.

## 5. Comment relancer tout ça

```
npm run wp:up                                   # le miroir
npx wrangler dev --port 8788 --ip 0.0.0.0       # le Worker, pour les fiches PDF
                                                # et pour la création du garde
docker compose -f wp-local/docker-compose.yml run --rm wpcli teeshoop gamme appliquer
npm run zones:mesurer -- --refaire              # relit les fiches de mesures
npm run verify:grille                           # le plancher
npm run test:wp                                 # 235 assertions
npm run verify:achat                            # les captures et 32 assertions
npm run ci                                      # le reste
```

Le Worker doit écouter sur `0.0.0.0` et pas sur `127.0.0.1` : le miroir l'appelle
depuis un conteneur, à `host.docker.internal`.
