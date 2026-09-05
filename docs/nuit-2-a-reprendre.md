# Nuit 2, ce qui reste à reprendre

> Écrite à la fermeture de la nuit du 4 septembre 2026, complétée le 5. Tout chiffre ici a été
> produit en faisant tourner la chose réelle contre le miroir docker. Ce qui n'a
> pas été mesuré le dit.

---

## 1. L'état des lieux, avant et après

| | Avant | Après |
|---|---|---|
| Produits achetables | 9 | 9 |
| dont montages de harnais | **8** | **0** |
| dont offres réelles avec référence fournisseur | 0 | **9** |
| Colonnes publiées **sous leur plancher de coût** | **102 sur 219**, puis 34 de plus | **0 sur 99** |
| Plancher appliqué | contribution 25 % | **marge brute 50 %, sa réponse Q06** |
| Gradient d'impression | la charte d'un dixième vêtement | **la fiche du fabricant vendu** |
| T-shirt, une face, 5 pièces | 14,50 EUR | **34,00 EUR** |
| T-shirt, une face, 50 pièces | 9,42 EUR | **22,10 EUR** |
| Sweat, une face, 5 pièces | 32,00 EUR | **73,00 EUR** |
| Refus « textile nu » du portail | **6** | **0** |
| Refus du portail, tous motifs | 23 | **17** |
| Sélecteurs de style pour panier, caisse, compte, commande reçue | **0** | 1 099 lignes |
| Paires (coloris, taille) proposées et inachetables | **10** | **0** sur 894 |
| `npm run test:wp` | 230 passées, 4 échouées | **238 passées** |

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

### Les deux défauts de géométrie sont corrigés (5 septembre)

**Le gradient suit maintenant la fiche du fabricant vendu.** Il lisait la charte
du Stanley/Stella pour grader neuf vêtements d'autres marques. Mesuré, part de la
demi-poitrine occupée par un marquage calé sur le M : 12,1 % d'écart entre S et
3XL sur le Fruit of the Loom, 19,1 % sur le Gildan Heavy Cotton, 0,0 % sur le
vêtement dont la charte vient, ce qui est le contrôle. `_teeshoop_demi_poitrine`
traverse jusqu'au document de création, la boutique vérifie le placement avec la
même série, et une seule maison (`readHalfChestSeries`) refuse une série
invraisemblable aux deux bouts. Détail complet dans
`docs/decisions/2026-09-05-le-gradient-suit-la-fiche-du-fabricant.md`.

**La grille et le panier disent maintenant la même chose sur les colonnes « sur
devis »**, et une assertion d'intégration compare les deux verdicts dans les deux
sens. Le seuil est celui de l'associé (2 000 EUR HT de commande, réponse 02) ; au
nouveau tarif il est franchi à cent t-shirts et cinquante sweats, donc ces
colonnes ne portent plus de prix public. `Pricing.php` disait que la question 02
était sans réponse : c'était faux depuis le 1er septembre, et le commentaire est
corrigé.

### Ce que la passe adversariale a trouvé, et qui est corrigé

Dix-huit trouvailles ont survécu à la réfutation, sept défauts distincts, tous
dans le travail de cette nuit et tous corrigés : une série de fabricant qui
survivait au changement de produit (35,0 cm de transfert sur un film de 33), un
rapport bâti sur deux vêtements (jusqu'à 2,56), une annulation qui retirait la
série, deux caches qui identifiaient une géométrie par une date qui ne bougeait
pas, un marquage fixe gradé quand même, une taille hors charte qui faisait tomber
toute une fournée, et un garde du plancher qui avait cessé de surveiller la taille
la plus chère. Le détail et les mesures sont dans
`docs/decisions/2026-09-05-le-gradient-suit-la-fiche-du-fabricant.md`, section 6.

Deux défauts hors sujet corrigés au passage : l'aperçu de plancher de l'écran des
règles ne calculait que la jambe de contribution (333,33 EUR annoncés contre
500,00 réels), et la fraîcheur d'un relevé de stock se mesurait contre la fin de la
journée, si bien qu'entre minuit et une heure la boutique déclarait périmé un
relevé d'une heure.

### Ce qui reste ouvert sur le gradient

**La boutique ne relit pas la série que porte le document.** `Cart::add` compare la
fiche du produit ouvert, pas celle qui voyage sur la création : c'est le studio qui
refuse une création calée sur un autre article (`CartModal`), et la boutique n'a
pas de second verrou parce qu'elle ne lit pas le document R2. Le chemin honnête est
fermé ; un document fabriqué à la main ne l'est que par les bornes de
`readHalfChestSeries`, rejouées côté atelier.

### Ce que le gradient corrigé a rendu visible

Un marquage carré au maximum du palier standard (25,0 cm de côté) ne tient pas
sur le film de 33 cm une fois gradé en 3XL sur les deux Gildan : 35,0 cm sur le
Heavy Cotton, 34,1 cm sur le Heavy Blend. Les trois B&C tiennent à 30,7 cm. La
boutique refuse la ligne avant le paiement et nomme la taille. C'est une
contrainte physique, pas un défaut, et elle est posée en question 65.

### La TVA n'est toujours pas tranchée, et ce n'est pas à nous

`H-Q17-TVA` ne porte aucune date de réponse, et quinze commandes réelles ont été
encaissées avec le calcul des taxes désactivé. Le portail refuse la mise en ligne
pour cette raison, et il a raison. C'est de l'argent et du droit qui sortent de
l'entreprise : ça appartient au développeur et à l'associé.
`ACCES-REQUIS.md` et `QUESTIONS-ASSOCIE.md` le portent.

### Quatre questions attendent l'associé

`QUESTIONS-ASSOCIE.md` Q64, réécrite : sa marge brute minimale de 50 % est
appliquée, elle donne 34,00 EUR le t-shirt et 73,00 EUR le sweat, et ce niveau
est au-dessus du marché relevé (mistertee entre 15,97 et 23,11 EUR). Confirme-t-il,
ou nous demande-t-il de redescendre sous son propre minimum ? Plus la remise de
quantité, qui est notre hypothèse. Q65, nouvelle : le 3XL Gildan. Plus Q62 et Q63
de la nuit 1 qui n'ont pas bougé.

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
| `npm run verify:grille` | une colonne publiée sous son plancher, une colonne sans plancher calculable, un coût amputé du textile ou du port, une taille dont le marquage ne tient pas sur le film, une exécution qui n'a rien mesuré | `base_ht` 13,00 -> 6,00 : code 1, **80 refus nommés** ; toutes les tailles rendues non imprimables : code 1, neuf références nommées ; puis retour à « 99 colonnes, toutes au-dessus » |
| `npm run zones:mesurer` | une fiche de mesures illisible, hors unité, non croissante ou incomplète ; une photo sans silhouette ; un col non trouvé ; un torse qui occupe plus des trois quarts de la boîte | les dix-huit photographies de la gamme, chacune avec sa raison |
| `printScale.test.ts` + `integration-gradient.php` | un gradient qui ignore la série du fabricant, une série non relue avant le film, la série d'un t-shirt appliquée à un sweat, un rapport bâti sur deux vêtements, une boutique qui vérifie le placement sur `garments.json` | six casses volontaires, six rouges, tout remis |
| `npm run verify:wp-e2e` | la chaîne complète du gradient dans un vrai navigateur : la page publie la fiche, `bridge.js` la poste, le studio la pose sur le document. **Il était mort depuis des semaines** (`frame-ancestors` de production servi au miroir) | la ligne de transmission retirée de `bridge.js` : code 1, `{"chart":null}` |
| `test-purchase.php` | un âge de relevé mesuré contre la fin du jour au lieu d'un instant | le plafond retiré : rouge sur « relevé de 6 h : la date et l'instant divergent » |
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
npm run wp:cli -- eval 'update_option("teeshoop_settings", array_merge((array) get_option("teeshoop_settings"), ["worker_url" => "http://host.docker.internal:8788"]));'
npm run verify:grille                           # le plancher
npm run test:wp                                 # 235 assertions
npm run verify:achat                            # les captures et 32 assertions
npm run ci                                      # le reste
```

Le Worker doit écouter sur `0.0.0.0` et pas sur `127.0.0.1` : le miroir l'appelle
depuis un conteneur, à `host.docker.internal`.
