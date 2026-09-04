# 4 septembre 2026 : la zone d'impression ne se mesure pas sur ces photographies, et voici le relevé

Ce document dit ce qui a été construit, ce qui a été mesuré, et pourquoi la
méthode que le brief décrit ne peut pas aboutir sur le catalogue tel qu'il est.
Elle n'a pas été abandonnée en silence : elle a été construite en entier, lancée
sur les neuf références de la gamme, et elle a refusé les dix-huit photographies
une par une, chacune avec sa raison.

---

## 1. Ce qui a été construit

`scripts/zones-mesurer.mjs`, lancé par `npm run zones:mesurer`. Il fait tourner
**le vrai code du studio dans un vrai navigateur, sur les vraies photographies de
la boutique** : le détourage (`src/lib/ingest/pipeline.ts`), la boîte englobante
(`src/lib/custom.ts`), l'anatomie (`src/lib/garmentAnatomy.ts`) et le placement
(`presetsFor()` de `src/app/PrintAreaPlacer.tsx`, exporté pour l'occasion).

Rien n'est réécrit. Une deuxième implémentation de « le plus grand marquage
raisonnable : le torse moins la couture, du col à l'ourlet » serait le défaut que
`CLAUDE.md` interdit : le jour où les deux dérivent, la boutique publie un
rectangle et l'éditeur en laisse dessiner un autre.

### La fiche de mesures : ça, ça marche, sur les neuf

Le fournisseur publie pour chaque style une fiche PDF. Trois fabricants, trois
documents, relevés le 4 septembre :

| Fabricant | Forme du tableau |
|---|---|
| B&C | une ligne « A HALF CHEST », valeurs qui **enjambent deux lignes** quand la mise en page l'exige, ligne de tailles parfois polluée par le texte voisin (« B&C KingLCrew XL ») |
| Gildan | un bloc « SPECIFICATIONS / Centimeters », ligne « Chest (A) », **deux colonnes de tolérance** avant les tailles, et le même tableau une deuxième fois **en pouces** juste en dessous |
| Fruit of the Loom | un tableau « Sizes / Width / Length », une taille par ligne |

Ce ne sont pas trois implémentations d'une règle, ce sont trois lecteurs de trois
documents. Ce qui leur est commun est extrait : l'assignation d'un nombre à une
taille se fait par **position de colonne**, ce que `pdftotext -layout` conserve.
C'est ce qui survit à l'enjambement de B&C et qui jette les colonnes de
tolérance de Gildan sans avoir à les connaître.

Un garde-fou d'unité refuse une demi-poitrine hors de [25, 95] cm : c'est ce qui
empêche de lire le tableau en pouces de Gildan, où 22 passerait pour 22 cm et
mettrait chaque marquage de ce vêtement à une échelle deux fois et demie trop
petite.

**Résultat : les neuf fiches sont lues.** La série de demi-poitrines taille par
taille est écrite sur chaque produit (`_teeshoop_demi_poitrine`). C'est l'entrée
du gradient de `src/lib/printScale.ts`, c'est-à-dire la façon dont le visuel
grandit d'une taille à l'autre.

**Et elle ne dit que ça.** Une charte de tailles ne place pas un marquage. Où le
rectangle se pose sur un polo, seule la photographie le dit.

---

## 2. Ce qui a été mesuré, et pourquoi tout a refusé

Dix-huit photographies, dix-huit refus, trois causes.

| Cause | Faces |
|---|---|
| Le torse occupe 85 à 99 % de la silhouette : la demi-poitrine ne s'y raccroche pas | 7 |
| La ligne de col n'est pas trouvée | 7 |
| Le détourage ne rend pas une forme de vêtement (`bad_aspect`) | 4 |

### La cause de fond : ces photographies ne sont pas des photographies à plat

`garmentAnatomy.ts` le dit dans son propre en-tête : « tout ce qu'on possède est
une photo À PLAT plus un seul nombre réel, la largeur à plat ». Regardées une par
une, les photographies de face de la gamme sont, pour la plupart, **un mannequin
vivant qui porte le vêtement** : un t-shirt B&C sur un homme cadré du menton aux
genoux, un sweat B&C ID.333 sur **deux personnes à la fois**. Le masque alpha est
alors une personne, avec une tête, des bras, un pantalon, et les repères qu'on en
tire ne sont les repères de rien.

Les photographies de dos, elles, sont majoritairement des vues produit à plat.
Mais un t-shirt de dos **n'a pas d'encolure creusée** : le col arrière est une
courbe de deux à trois centimètres, sous les seuils que le détecteur applique
pour ne pas prendre l'échancrure d'un débardeur ou le V d'un col de polo pour une
encolure. Le refus est correct.

### Le défaut que ce travail a intercepté, et c'est le plus important

Avant le contrôle de vraisemblance, **le B&C ID.333 était « mesuré »** : le
détecteur avait trouvé une encolure entre les deux mannequins de sa photographie
et rendait un rectangle de **47,5 x 48,6 cm**, qui serait parti sur la fiche
produit et de là chez l'imprimeur. Un chiffre fabriqué qui atteint une machine.

Le contrôle mesure une seule chose et ne prétend rien de plus : **la part de la
silhouette qu'occupe le torse**. Un vêtement à manches écartées la met vers la
moitié, parce que les manches élargissent la boîte sans élargir le torse ; c'est
le seul cas où la demi-poitrine du fabricant se raccroche à ce qu'on voit. Relevé
sur les dix-huit : **0,54** sur la seule vraie photo à plat manches écartées,
**0,85 à 0,99** sur toutes les autres. Aucune valeur entre les deux.

### Une erreur d'échelle corrigée en chemin

La première version prenait la largeur de la boîte englobante pour la
demi-poitrine, ce que fait `getCustomSideInfo()` et ce qui est juste quand un
CLIENT mesure son propre vêtement et photographie ce qu'il a mesuré. C'est faux
d'une photo de catalogue : un t-shirt à plat manches écartées a une boîte large
comme l'envergure des manches. Mesuré sur le Fruit of the Loom Valueweight,
torse 28,7 cm pour une boîte de 53,5 : **une échelle fausse de 86 %**.

La demi-poitrine du fabricant est définie par le fabricant lui-même comme « la
largeur du vêtement à 1 cm sous les emmanchures » (Fruit of the Loom, sur sa
propre fiche). C'est le torse. L'échelle s'y prend maintenant.

---

## 3. Décision : rien n'est écrit, et rien n'est approximé

Aucune référence de la gamme ne porte de zone d'impression. Toutes portent leur
demi-poitrine et leurs refus nommés (`_teeshoop_zone_refus`), et toutes restent
non personnalisables tant qu'un humain n'a pas posé le rectangle à la main.

`CLAUDE.md` section 3 : un visuel qui ne peut pas être mesuré est refusé, pas
posé à sa taille par défaut. Une zone approximative sur neuf références aurait
donné neuf fiches produit qui publient une dimension d'impression fausse, et un
atelier qui coupe au bon endroit d'un rectangle qui n'est pas le bon.

## 4. Ce qu'il faudrait, nommément

Trois chemins, du moins cher au plus cher.

1. **Demander au fournisseur ses vues produit à plat, manches écartées.** Elles
   existent chez lui pour une partie du catalogue (le Fruit of the Loom
   Valueweight en est une). C'est une question commerciale, pas technique, et
   elle est dans `ACCES-REQUIS.md`.
2. **Poser la zone à la main dans l'écran d'administration**, référence par
   référence, avec `PrintAreaPlacer` qui existe déjà et qui est fait pour ça.
   Neuf références de la gamme de lancement, c'est une heure. Trois cents, non.
3. **Apprendre au détecteur à trouver l'encolure d'un dos**, qui est une courbe
   et pas une échancrure, et à trouver un vêtement à l'intérieur d'une photo de
   mannequin. Le second est un vrai projet de vision, pas un réglage de seuil.

Ce qui NE marchera pas : baisser les seuils du détecteur de col. Ils sont là
parce que l'échancrure d'un débardeur et le V d'un polo se sont déjà fait prendre
pour des encolures, et les rouvrir remplacerait dix-huit refus honnêtes par
dix-huit rectangles faux.
