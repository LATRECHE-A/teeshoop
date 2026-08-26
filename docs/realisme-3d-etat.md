# À quelle distance de la photo sommes-nous, et ce que coûte le reste

Le brief de la séance 10 demande, en dernière ligne, une réponse honnête à deux questions :
à quelle distance de la photo l'aperçu 3D se trouve, et ce que coûterait de combler l'écart.
Ce document y répond avec les mesures de la séance, et il nomme ce qui n'est pas mesuré.

Il ne raconte pas la séance : cela est dans `docs/ROADMAP.md`. Il ne donne pas l'état des
contrôles : cela est dans `docs/seance-10-a-reprendre.md`.

---

## La réponse courte

**Sur un vêtement du catalogue, l'aperçu ne se fait plus passer pour une photo, et il n'a
plus l'air d'un dessin.** C'est un rendu 3D honnête : la matière se lit comme du tissu, le
visuel se lit comme imprimé dedans et non posé dessus, et l'objet tient dans sa scène. Un
client comprend ce qu'il achète. Il ne croira pas que c'est une photo, et rien dans la
boutique ne le lui fait croire.

**Sur un vêtement envoyé par le client, non**, et c'est un écart de nature, pas de degré :
ce chemin part d'une photo, pas d'un maillage, et il est décrit plus bas.

Ce qui suit dit sur quoi cette réponse s'appuie.

---

## Ce qui est mesuré, et par quoi

Quatorze cas, balayage complet du 26/08/2026 (`.qa/render-s2`), 73 assertions vertes sur 74.
Ce que les vertes affirment, en clair :

- **Le contour se lit** partout : la marche de luminance entre le vêtement et son fond fait
  au moins 12 niveaux de médiane sur les quatorze cas, et 22,3 sur le pire (un sweat noir
  en studio). Un vêtement qu'on ne détoure pas de son fond est le premier défaut qu'un client
  voit, avant toute question de matière.
- **Le tissu a de la nuance dedans** : 59 niveaux du 5e au 99e centile sur un noir, 88 sur
  un blanc. C'est ce qui sépare du tissu d'un aplat de couleur.
- **Le vêtement pose une ombre sur quelque chose** : de 9 424 à 38 475 pixels de contact au
  sol selon la scène. Un objet qui flotte se lit comme une vignette, pas comme un produit.
- **Un blanc lit blanc et neutre** en studio (215/216/219), et une teinte neutre reste
  neutre. Les autres scènes teintent, et c'est voulu : un soleil couchant qui ne teinte pas
  le coton serait faux en photographie avant d'être juste en colorimétrie.
- **Le cadrage est reproductible** : chaque vêtement est centré à 0,1 % près, aucun ne touche
  un bord, et le contrôle de déterminisme relit la même image à 0,00 près en fin de balayage.

Ce que la séance a changé, mesuré à instrument identique sur l'arbre d'avant et l'arbre
d'après (`.qa/before-3d-fixed` contre `.qa/after-3d-now`, 14 images de chaque côté) : douze
des quatorze prises changent sur 70 à 84 % de leurs pixels, toutes dans le même sens. Un
t-shirt noir de face passe d'une moyenne RVB de 16,1/17,5/20,7 à 32,2/36,4/43,4 ; un sweat
sombre en studio de 19,8/21,5/24,8 à 38,5/43,1/50,9. En clair : les vêtements sombres
existaient à peine et existent maintenant.

---

## Ce qui manque pour que ce soit une photo

Cinq choses, de la plus visible à la moins.

### 1. Le vêtement est une coque, pas un patron cousu

C'est le premier écart et de loin le plus gros. Un vrai vêtement est fait de pièces coupées
et assemblées : l'épaule a une couture qui casse la lumière, le côté en a une autre, l'ourlet
est un repli à double épaisseur, la côte du col a une structure qui n'est pas celle du corps.
Notre maillage n'a rien de tout cela : c'est une surface continue à laquelle on donne
l'épaisseur du tissu.

Ce que cela donne à l'œil : les plis sont là où la géométrie les a mis, pas là où la coupe
les impose. Le tissu tombe de façon plausible et jamais de façon *particulière*, alors qu'un
vêtement photographié a des plis qui viennent de sa couture et de sa gravité.

**Est-ce la seule vraie correction ?** Le brief pose la question et demande une réponse
nette, pas un chiffrage à l'aveugle. La réponse est **non pour vendre, oui pour la photo**.

Non pour vendre : cette séance a obtenu l'essentiel de ce qui manquait sans y toucher. Douze
des quatorze prises ont changé sur 70 à 84 % de leurs pixels, les vêtements sombres sont
passés d'invisibles à lisibles, et les quatorze gardes de composition, d'ombre, de contour et
de neutralité tiennent. Ce qui bloquait un client n'était pas la coupe du maillage, c'était
qu'un t-shirt noir ne se voyait pas.

Oui pour la photo : tant que la géométrie est une coque, les plis viennent de la coque. Aucun
réglage de nuanceur ne fabrique une couture d'épaule qui n'existe pas dans le maillage. Si
l'objectif devient « on ne distingue pas de la photo », c'est le seul chemin.

**Ce que le chantier contient**, pour que la décision se prenne sur autre chose qu'une
intuition. Quatre pièces, et la quatrième est celle qui fait peur :

1. **Les patrons** : les pièces à plat, par vêtement et par taille. Nous ne les avons pas ;
   le fournisseur donne des mesures de tableau de tailles, pas des patrons de coupe.
2. **La mise en volume** : un solveur de tissu, ou une bibliothèque de plis cuits par
   vêtement et par taille. Le solveur est plus juste, la bibliothèque est ce qui tient dans
   un navigateur.
3. **La matière** : elle est déjà là et ne serait pas à refaire. Le tissage est procédural en
   espace de face (`src/three/clothShading.ts`), sans jeu d'UV : il suivrait la nouvelle
   géométrie sans réglage.
4. **Le placement d'impression, qui est le vrai risque.** Toute la géométrie d'impression est
   calée sur la coque actuelle, et elle est PARTAGÉE avec la 2D, l'AR et le DTF par un
   décalage par face unique, précisément pour qu'elles ne divergent pas. Changer la surface
   sous l'impression, c'est refaire ce calage et re-mesurer la concordance des quatre
   chemins. Aujourd'hui elle est de 0,0 à 0,5 % (`scripts/parity-verify.mjs`). C'est le
   nombre qui dit qu'une taille imprimée correspond à ce qui a été vendu, et c'est ce que la
   boutique facture et imprime.

Autrement dit : le rendu est la partie facile et connue, le calage d'impression est la partie
où une erreur coûte des vêtements imprimés faux. Un chantier de cette forme se décide, il ne
se glisse pas dans une séance.

### 2. Le vêtement envoyé par le client ne peut pas être meilleur que sa photo

Chemin différent de bout en bout. Le client envoie une photographie, on la détoure, on la
« dé-éclaire » pour pouvoir la recolorer, et on la pose sur une coque gonflée. Le
dé-éclairage retire le modelé que la géométrie ne sait pas rendre : de là l'aspect découpage
de papier, connu et documenté.

Deux conséquences qui ne sont pas des oublis mais la conséquence du chemin, et qui valent
d'être écrites avant que quelqu'un les « corrige » :

- **L'encre n'a pas de tranche de film** sur ce chemin, parce que le visuel est composé en 2D
  dans la photo du vêtement avant d'arriver en 3D : il n'existe pas comme couche séparée à
  éclairer.
- **Le liseré d'alpha droit ne l'atteint pas** non plus : à l'intérieur du vêtement, la photo
  est opaque.

Vérifié pendant la séance : les deux prises `inflate-*` sont **identiques à l'octet** avant et
après. Améliorer le vêtement du catalogue n'a pas touché celui du client, ce qui était le
piège nommé par le brief.

**Ce que coûte de le combler** : il faudrait ne plus dé-éclairer, donc pouvoir recolorer sans
détruire le modelé, donc séparer l'éclairage de la couleur dans la photo d'entrée. C'est de
l'estimation d'illumination sur une image unique. C'est un sujet en soi, et il est probable
que la bonne réponse produit soit de ne pas recolorer les vêtements envoyés par le client.

### 3. Pas de vue « porté », et c'est un refus motivé

Le brief demandait quatre images par vêtement : avant, dos, détail, porté « si nous avons un
avatar assez bon ». Les trois premières existent. L'avatar existe et n'est pas assez bon : il
ne se décline pas en tailles, parce que le corps et le vêtement sont un seul maillage cuit.
Mesuré : la dérive du placement d'impression entre tailles est de **0,111 sur l'avatar contre
0,005 en 2D et en 3D**, c'est-à-dire qu'il ne se décline pas.

Sur une boutique où la taille d'impression est un engagement facturé et imprimé, une image
qui ment sur le produit vaut moins que pas d'image. La question produit est la **Q52**.

### 4. Le liseré d'encre est imprimé et pas gardé

La correction (prémultiplication, division, décodage) est de l'arithmétique démontrable, mais
la mire de calibrage cerne ses propres lettres d'un trait noir, donc le compteur de liseré
compte ce trait autant qu'un défaut. Le nombre est affiché à chaque balayage et n'est
opposable à personne.

**Ce que coûte de le combler** : une mire à bords francs sans noir à elle. C'est petit.

### 5. Un vêtement sombre dans la scène `night` est à la limite

Le seul contrôle rouge des soixante-quatorze. Détaillé dans `docs/ROADMAP.md` ; c'est le
sujet qui reste ouvert et il est chiffré.

---

## La vitesse fait partie du réalisme, et ce qu'on peut honnêtement en dire

Le brief demande de mesurer le temps par image « sur un profil de téléphone milieu de gamme,
pas sur cette machine ». La deuxième moitié de la phrase est le problème : **il n'y a pas de
carte graphique sur cette machine**. Chromium rastérise en logiciel sur le processeur, et les
millisecondes qui en sortent n'ont aucun rapport avec un Mali ou un Adreno. Écrire « 16 ms sur
un téléphone milieu de gamme » à partir de cette sortie serait inventer un nombre.

Ce qui a donc été mesuré est ce qui voyage (`scripts/frame-bench.mjs`, `.qa/frame-bench-after2.json`) :

| ce qui est compté | t-shirt | sweat |
|---|---|---|
| appels de dessin par image | 21 | 21 |
| triangles | 234 594 | 811 698 |
| programmes de nuanceur | 11 | 11 |

Ces trois nombres sont identiques sur toute machine et c'est contre eux qu'un budget se
tient. Vingt-et-un appels de dessin est bas ; c'est la mesure qui dit que l'aperçu n'a pas
été rendu réaliste en empilant des passes.

Et le rapport entre les deux profils, mesuré dos à dos sur le même rastériseur dans la même
exécution, ce qui divise la machine : le profil téléphone (carte d'ombre 2 048 -> 1 024,
anticrénelage coupé, densité de pixels plafonnée à 1,25) coûte **2,67 fois** le profil bureau
sur le t-shirt et **1,89 fois** sur le sweat. Le fait que le t-shirt coûte plus cher que le
sweat alors qu'il porte 3,46 fois moins de triangles dit que ce rastériseur est limité par le
remplissage et non par la géométrie : le t-shirt couvre 38,8 % du panneau et le sweat 21,0 %.
Une vraie carte graphique gagnerait probablement ce marché-là et remettrait le sweat devant.

**Ce qui n'est donc pas mesuré, et qu'il ne faut pas prétendre :** le temps par image sur un
téléphone réel. Cela demande un téléphone réel. C'est la mesure à prendre en séance 13, où la
performance est le sujet, avec un appareil dans la main.

---

## Ce que l'aperçu ne prétend pas être

Deux choses valent d'être dites parce qu'elles évitent une déception plus tard.

L'aperçu n'est pas un bon à tirer. Un BAT doit montrer des cotes, pas une ambiance, et il est
par création, pas par vêtement : il ne peut être rendu que dans le navigateur du client, où
three.js est un morceau paresseux de 1,1 Mo que le brief interdit de rendre gourmand.

**Et il ne couvre pas la boutique.** C'est le point à avoir en tête avant la séance 11, qui
est celle du référencement et du contenu. La boutique publie **462 produits** : 459
références importées du fournisseur et 3 produits personnalisables du studio
(`docs/CATALOGUE.md`). Le studio, lui, ne connaît que **deux** vêtements en 3D, le t-shirt et
le sweat à capuche (`src/garments/index.ts`), plus le vêtement téléversé, qui est par
définition celui du client et ne peut pas être rendu d'avance. Autrement dit : même en
branchant les mockups sur les fiches produit demain, 459 fiches sur 462 continueraient de
montrer les photographies du fournisseur, celles que tous ses autres revendeurs utilisent.
Ce n'est pas un défaut du rendu, c'est la portée du rendu, et cela se décide (Q10).

L'aperçu n'est pas non plus la photo de fiche produit d'aujourd'hui : `scripts/mockup-shots.mjs`
produit un jeu déterministe de seize images, et rien ne les relit encore. Le panier, le bon à
tirer et les e-mails montrent toujours l'aperçu plat de `renderMockup`. Brancher l'un sur
l'autre est un projet à décider, pas un raccord oublié.
