# 5 septembre 2026 : le marquage grandit avec le vêtement vendu, pas avec un vêtement de référence

Décision prise seule, la nuit. Elle porte sur la taille physique d'un transfert
qui part chez l'imprimeur, elle est donc écrite en entier.

Tous les chiffres viennent de commandes dont la sortie est dans la transcription
de la séance.

---

## 1. Le défaut, mesuré avant d'être cru

L'éditeur agrandit un marquage d'une taille à l'autre par un rapport de
demi-poitrines (`src/lib/printScale.ts`). Ce rapport venait de
`src/content/sizeChart.ts`, qui ne connaît qu'un vêtement par famille : le
Stanley/Stella Creator pour le t-shirt, le Cruiser pour le sweat. La boutique
vend des B&C, des Gildan et des Fruit of the Loom.

Mesuré sur les références importées, part de la demi-poitrine qu'occupe un
marquage calé sur le M :

| Référence | part en S | part en 3XL | écart |
|---|---|---|---|
| 01542 B&C #E150 | 0,01885 | 0,01893 | -0,5 % |
| 15001 Fruit of the Loom Valueweight | 0,01943 | 0,01733 | **12,1 %** |
| 18009 Gildan Heavy Cotton | 0,02061 | 0,01731 | **19,1 %** |
| 29009 Gildan Heavy Blend (sweat) | 0,01877 | 0,01604 | **17,0 %** |
| Stanley/Stella Creator | 0,01923 | 0,01923 | 0,0 % |

La dernière ligne est le contrôle de la mesure : sur le vêtement dont la charte
vient, l'écart est nul, comme il doit l'être. Le défaut est donc réel et son
ampleur est mesurée, pas estimée.

Le même fichier, la même commande, un rendu visiblement différent selon la
taille. Et c'est le FILM qui en hérite : `src/lib/dtf/pieces.ts` appelle
`printScaleK` au moment de découper.

## 2. Le chemin de la donnée, et pourquoi il passe par le document

La fiche du fabricant est déjà sur le produit (`_teeshoop_demi_poitrine`, posée
par `npm run zones:mesurer`). Elle traverse maintenant jusqu'au studio :

`ProductPage::maker_chart()` -> `Shortcode::enqueue()` -> `assets/bridge.js` ->
`src/lib/teeshoop/bridge.ts` -> `useShopSizeChart` -> `Design.shopSizeChart` ->
`buildDocument` -> R2 -> `src/lib/dtf/pieces.ts`.

**Elle vit sur le document et pas dans un état ambiant** parce que le film est
découpé plus tard, à partir du document stocké. Un état ambiant serait absent au
moment où l'atelier découpe, et le film reprendrait la charte du studio sans que
rien ne le dise.

**Le vêtement est DANS le champ** (`{garmentId, halfChestCm}`) et pas à côté :
l'éditeur laisse changer de vêtement à tout moment, et un champ nu graderait une
capuche par la poitrine d'un t-shirt. Changer de vêtement fait retomber le
gradient sur la charte du studio sans rien effacer ; revenir le remet en service.

## 3. La série est relue là où le film est découpé, pas seulement à l'entrée

La passerelle valide ce qu'elle reçoit, mais elle tourne dans le navigateur du
client, et le document part ensuite sur une route ouverte qui ne peut demander
aucune identité (`worker/design.ts`). Le contrôle d'entrée est donc du côté que
l'on ne tient pas.

`readHalfChestSeries()` (`src/content/sizeChart.ts`) est la seule maison de la
règle, appelée aux deux bouts. Elle refuse **totalement**, jamais partiellement :

- une valeur hors de [25, 95] cm : bornes mesurées sur les dix séries importées,
  de 45,72 cm (Gildan en S) à 86,36 cm (Gildan en 5XL). Hors de là, c'est une
  fiche en pouces ou un document fabriqué ;
- une série qui ne monte pas : colonnes décalées à la lecture du PDF ;
- un rapport entre extrêmes supérieur à 2 : le pire vêtement réel fait 1,556
  (Gildan Heavy Cotton, 71,12 / 45,72), donc deux laisse trente pour cent de
  marge et refuse ce qui ferait imprimer au double.

Une série à demi crédible n'est pas à moitié utilisable : grader trois tailles
sur six ferait varier le marquage sans raison lisible.

## 4. La boutique vérifie le placement avec la même série

`Design::unprintable_sizes` refusait une taille en gradant par `garments.json`,
dérivé de la charte du studio. Les deux ne montent plus pareil : sur le Gildan
Heavy Cotton, le rapport 3XL/M vaut 1,400 chez le fabricant contre 1,2295 dans
`garments.json`, **13,9 % d'écart**. La boutique vérifiait donc une pièce plus
petite que celle que l'atelier découpe, et vendait un 3XL que le nid refuserait
ensuite comme trop grand.

Elle lit maintenant la série du produit. Facteur unique en largeur et en hauteur,
parce que la gradation du studio est uniforme ; deux facteurs ici en seraient une
seconde implémentation. Quand la série ne porte pas la taille demandée, elle
retombe sur `garments.json` et **pas** sur un facteur de 1 : « la série ne répond
pas » n'est pas « le marquage ne grandit pas ».

## 5. Ce que cela rend visible, et qui n'est pas un défaut

Un marquage carré au maximum du palier standard (625 cm², 25,0 cm de côté) ne
peut pas être produit en 3XL sur les deux Gildan :

| Référence | 3XL / M | côté en 3XL | film de 33 cm |
|---|---|---|---|
| Les trois B&C | 1,2264 | 30,7 cm | tient |
| Gildan Heavy Blend | 1,3636 | 34,1 cm | dépasse |
| Gildan Heavy Cotton | 1,4000 | 35,0 cm | dépasse |

La boutique refuse la ligne avant le paiement et nomme la taille. C'est une
contrainte physique qui était invisible tant que tous les vêtements étaient
gradés par la grille d'un seul. Elle est posée à l'associé (question 65).

Le garde du plancher (`npm run verify:grille`) mesure en conséquence à la taille
la plus chère que la boutique sait imprimer, et l'annonce en clair :

```
2 mesure(s) prise(s) autrement, et pourquoi :
  18009 (tee) : mesuré en 2XL et non en 3XL, parce qu'un marquage de 25,0 cm de
  côté dépasse le film une fois gradé à ces tailles.
```

## 6. Ce que la passe adversariale a trouvé sur ce travail, et qui est corrigé

Quatre lentilles en parallèle sur le diff, chaque trouvaille passée ensuite à un
réfutateur qui devait la démolir en lisant le vrai code. Dix-huit ont survécu, et
elles se ramènent à sept défauts distincts. Tous étaient dans le code que cette
note décrit, et tous sont corrigés ici.

**Une série étrangère survivait au changement de produit** (film gâché). Le studio
est une origine et un brouillon : un client qui décore un B&C puis ouvre un Gildan
gardait la série du B&C. Sur dix-sept produits personnalisables, cinq portent une
fiche. La boutique validait alors le placement avec la fiche de la page ouverte
(donc `garments.json`, rapport 1,2295) pendant que l'atelier découpait à 1,4000 :
35,0 cm de transfert sur un film de 33 cm, payé et impressable. Corrigé en trois
points : une série vide EFFACE la précédente, l'effet ne touche pas une ligne du
panier ouverte (elle appartient à une autre offre), et `CartModal` refuse une
création calée sur un autre article, comme il refuse déjà une couleur qui n'existe
pas.

**Un rapport pouvait mélanger deux vêtements** (film gâché). `halfChestCm`
retombait taille par taille sur la charte du studio. Mesuré : une série honnête
mais courte donnait k(3XL) = 64 / 50,8 = 1,2598, le 3XL du Stanley/Stella divisé
par le M du Fruit of the Loom ; une série fabriquée { S: 25, M: 26 }, que le
contrôle de vraisemblance accepte pièce à pièce, donnait 64 / 25 = **2,56**. La
borne de rapport ne pouvait rien voir : le rapport tordu n'est pas dans la série,
il est entre la série et la charte. La série est maintenant la seule source ou
n'en est pas une.

**Une annulation retirait la série** (dégradé). Le comparateur de zundo est
l'identité de l'objet `design`, donc la pose faisait une entrée d'historique : un
client appuyant sur annuler juste après l'ouverture repassait au gradient du
studio sans que rien ne le dise. L'historique est mis en pause pendant la pose.

**Deux caches identifiaient une géométrie par `updatedAt`** (film gâché).
`mockupCache` et `DtfModal` le font, et le fichier du premier annonçait ce défaut
d'avance. La pose ne datait pas le document, donc deux lignes du panier faites sur
deux vêtements différents portaient la même clé et fusionnaient : vingt transferts
pressés au facteur de dix d'entre eux. La date bouge maintenant, sans entrée
d'historique.

**Un marquage unique pour toutes les tailles était gradé quand même** (vente
perdue). Le drapeau `graded` voyage déjà sur chaque face. Un carré de 25,0 cm en
mode fixe était refusé en 3XL avec la phrase « le marquage grandit avec le
vêtement », qui est fausse pour cette création. Le drapeau est lu.

**Une taille que le studio ne dessine pas passait** (fournée entière perdue). Les
fiches fournisseur montent au 5XL, `garments.json` s'arrête au 3XL et le refusait
déjà par son propre contrôle ; la nouvelle branche le contournait. Un 4XL
atteignait ensuite `sizeSpecCm('tee','4XL')`, indéfini, et faisait tomber le rendu
de toute la fournée. Refusé dans les deux branches.

**Le garde du plancher cessait de surveiller la taille la plus chère** (argent).
Il descendait d'une taille quand le marquage du palier ne tenait plus sur le film.
Mesuré : 29009, une face, vingt-cinq pièces, passait de 10,73 EUR de marge
au-dessus du plancher à 318,23 EUR annoncés. Or le prix ne dépend pas de la
surface à l'intérieur du palier : le garde garde la taille et rétrécit le carré
(23,5 cm sur le 18009, 24,2 sur le 29009), ce qui reste une commande réelle au même
prix publié.

Deux trouvailles hors de ce travail ont été corrigées au passage : l'aperçu de
plancher de l'écran des règles ne calculait que la jambe de contribution (il
annonçait 333,33 EUR là où le plancher réel est 500,00), et le panneau produit du
studio publiait la charte du Stanley/Stella à côté d'une boutique qui affiche la
fiche du fabricant, soit deux tours de poitrine à 7,12 cm l'un de l'autre sur un
seul écran.

## 7. Les gardes, et la preuve qu'ils savent refuser

| Cassé volontairement | Résultat |
|---|---|
| le gradient ignore la série du fabricant | 2 tests rouges (`printScale.test.ts`) |
| la série n'est pas relue avant le film | 4 tests rouges |
| la série d'un t-shirt grade un sweat | 1 test rouge |
| la boutique ignore la série (`grading_factor` rendue nulle) | 1 test rouge (`integration-gradient.php`) |
| aucune taille imprimable | `verify:grille` code 1, neuf références nommées |

| bridge.js ne transmet plus la série | `verify:wp-e2e` code 1, `{"chart":null}` |
| le repli taille par taille revient | 2 tests rouges |
| l'historique n'est pas mis en pause | 2 tests rouges |
| `clear()` au lieu de `pause()` | 1 test rouge |

Tous remis en état, tout revert vert : 241 assertions `test:wp`, 567 `test:php`,
297 côté studio, 106 sur `verify:wp-e2e`, 99 colonnes sur `verify:grille`.

## 8. Un harnais qui était mort depuis un moment

`npm run verify:wp-e2e` mourait sur « canvas jamais visible » après quatre-vingt-dix
secondes. Cause trouvée en ouvrant la page dans un navigateur :
`ERR_BLOCKED_BY_RESPONSE`, le Worker répondant
`frame-ancestors https://teeshoop.com ...` parce que le harnais passait l'origine
de la boutique à `npm run build` (la liste blanche du STUDIO) et laissait le
Worker prendre la sienne dans `wrangler.jsonc`. Il était rouge depuis le jour où
ces origines de production y ont été écrites. Les deux réglages viennent maintenant
de la même variable. Le harnais rend 106 assertions vertes, et c'est lui qui prouve
la chaîne complète du gradient dans un vrai navigateur.
