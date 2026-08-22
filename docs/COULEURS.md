# Les couleurs du catalogue : comment elles sont mesurées

Le fournisseur envoie 442 noms de coloris et **aucun code hexadécimal**. Il envoie en
revanche deux images par coloris : un **nuancier**, aplat de la teinture
(`sku_color_swatch_url`), et une **photographie** du vêtement dans cette couleur. Ce document
décrit comment ces deux images deviennent la pastille affichée à côté du nom dans le filtre
du catalogue, laquelle des deux décide, ce que la mesure refuse de faire, et ce qui reste à
faire.

**La couleur déclarée, ce n'est pas une déduction.** Mesuré sur onze nuanciers de 168 x 126 px :
entre 99,2 % et 100 % de chaque cadre est une seule couleur, et l'écart au 90e centile par
rapport à sa médiane est de 0,0 sur les onze. Le nuancier est donc la valeur du fournisseur,
livrée en image plutôt qu'en texte. C'est lui qui est publié.

**La photographie sert de contrôle, pas de valeur.** Les deux sont mesurées séparément et leur
distance est enregistrée, parce que le fournisseur est connu pour réutiliser la photo d'un
coloris pour un autre. Une photo qui ne correspond pas à son propre nuancier, c'est cette
panne-là. Le désaccord est rapporté à l'exploitant, il ne refuse pas la pastille : c'est la
pastille qui est juste, et cacher la pastille ne réparerait pas la photo. Quand aucun nuancier
n'est lisible, la photo devient la valeur, par le détourage décrit plus bas.

Les deux chemins finissent sur la même fonction, `Swatch::centre()`. Il y a **une** règle pour
« de quelle couleur est ce vêtement », la médiane marginale en OKLab, et deux façons de lui
amener des pixels.

Le code est en deux moitiés :

| Fichier | Ce qu'il fait |
|---|---|
| `wp-plugins/teeshoop-core/includes/Swatch.php` | l'arithmétique. Aucun appel à WordPress, aucun appel à GD : il prend des pixels et rend des nombres, donc `tests/run.php` l'exerce entièrement sur une machine qui n'a ni l'un ni l'autre. |
| `wp-plugins/teeshoop-core/includes/Colours.php` | la boutique. Trouve le nuancier et les photos d'un coloris, les récupère, les décode, écrit le verdict sur le terme. |
| `wp-themes/teeshoop/template-parts/facet-couleur.php` | ce que l'acheteur voit. |
| `scripts/couleurs-guard.mjs` | vérifie que le relevé publié et le code disent encore la même chose. |

---

## 1. Pourquoi mesurer

Le chapitre 04 de la Bible ouvre sur une phrase : « le catalogue doit se comporter comme un
moteur de recherche spécialisé, pas comme une succession de centaines de pages ». La couleur
est le premier critère sur lequel un acheteur professionnel resserre, et la consigne est
qu'on ne fusionne pas les noms : « Navy », « French Navy », « Deep Navy » et « Midnight »
sont quatre articles, et celui qui recommande dans dix-huit mois a besoin du nom qu'il a
acheté.

Les deux contraintes ensemble donnent 442 cases à cocher dans une liste déroulante. Ce n'est
pas un filtre, c'est un dictionnaire. Il fallait donc une valeur de couleur à côté de chaque
nom, pour deux usages : **dessiner la pastille**, et **regrouper** les 442 noms en onze
familles qu'un acheteur reconnaît, sans en fusionner aucun.

Cette valeur n'existe nulle part. Elle est donc mesurée.

---

## 2. Ce qui est mesuré, sur quoi

L'importateur écrit sur chaque déclinaison le chemin du nuancier de son coloris
(`Catalogue::META_COLOUR_CHIP`) et celui de sa photo (`Catalogue::META_COLOUR_PHOTO`). Une
requête groupée donne donc, pour chaque nom de coloris, les images qui le représentent,
triées pour être reproductibles. **Cinq au maximum par coloris**, prises dans l'ordre, ce qui
donne cinq références différentes plutôt que cinq tailles du même vêtement.

Plusieurs images ne servent pas à affiner une médiane que deux ont déjà fixée. Elles servent
à **désaccorder** : une couleur mesurée sur une seule image est publiée avec `images = 1`
sur son relevé, et `wp teeshoop couleurs etat` dit combien du catalogue tient sur un seul
cliché.

### La mesure d'un nuancier

Trois lignes : décoder, prendre la médiane, vérifier que c'en est bien un. Aucun détourage,
aucune segmentation, aucun seuil de clarté. Le nuancier n'est **pas** réduit avant d'être
mesuré : il fait déjà 168 x 126, et une réduction bilinéaire inventerait des couleurs
intermédiaires le long de ses bords, ce que le contrôle de planéité regarde précisément.

Deux verrous, et le second a été écrit deux fois.

- **Planéité.** Au moins 60 % du cadre doit être sur la couleur, ou les deux couleurs, qui
  viennent d'être trouvées.
- **Ce n'est pas un vêtement détouré.** La première version croyait qu'un contrôle de planéité
  suffisait à distinguer un nuancier d'une photo. C'est faux : un détourage sur blanc est *deux
  aplats*, donc « quelle part du cadre est sur l'une des deux couleurs » répond « tout », et une
  photo passait sans bruit. La boutique aurait publié la couleur du fond. Ce qui les sépare, c'est
  qu'**un fond entoure son sujet** : sur un détourage une couleur touche les quatre côtés du cadre
  et l'autre aucun, alors que sur un nuancier coupé en deux chaque moitié touche trois côtés.

### La mesure d'une photographie, étape par étape

1. **Réduction à 256 px de large.** (La photo seulement ; le nuancier n'est pas réduit.) Mesuré sur le miroir, décodage plus mise à l'échelle
   plus lecture, moyenne de six photos fournisseur de 1024 px : 41 ms à 320 px, 26 ms à 256,
   16 ms à 192, 12 ms à 128. 256 garde environ 33 000 pixels de vêtement, quatre ordres de
   grandeur de plus qu'une médiane n'en demande, pour 14 ms de plus que l'option la moins
   chère.

2. **Le fond, par sa bordure.** La médiane des pixels du contour donne la couleur du fond.
   Si la bordure n'est pas uniforme (photo d'ambiance, mannequin dans la rue, dégradé), la
   photo est **refusée** : cette méthode ne sait pas la traiter et la réponse honnête est
   qu'il n'y a pas de pastille. Mesuré sur quatorze photos de référence : le fond est
   exactement (255,255,255) sur les quatorze et son propre écart au 90e centile est 0,0.

3. **Le fond, par remplissage connecté depuis le bord.** C'est l'étape qui décide de toute
   la conception. **Un t-shirt blanc est photographié sur fond blanc**, et ses propres
   hautes lumières *sont* la couleur du fond. N'importe quelle règle du type « enlève tout ce
   qui ressemble au fond » découpe un trou dans le vêtement et emporte le haut de sa plage de
   clarté. Un remplissage qui ne peut entrer que par le bord du cadre ne peut pas atteindre
   un trou entouré de chemise.

   La tolérance est de 6 sur 441. Elle a valu 10, et à 10 elle mangeait un vêtement :
   « Snowwhite » se photographie vers rgb(250,250,248), à 9,9 du fond.

4. **Érosion de 2 px.** Un pixel de bord, après réduction, est un mélange de fond et de
   tissu. Il est retiré.

5. **Deux refus, qui ne disent pas la même chose.** Moins de 3 % de vêtement dans le cadre :
   « sujet absent ou trop petit ». Moins de 10 % de fond retiré : « aucun fond détecté »,
   c'est-à-dire que cette photo n'est pas un détourage, quoi qu'ait dit sa bordure.

6. **La couleur : la médiane marginale en OKLab.** La médiane et non la moyenne, parce
   qu'une photo de vêtement contient une brillance sur une épaule, une ombre sous l'autre et
   une étiquette de col imprimée, et que la moyenne est tirée par les trois. La médiane est le
   pixel dont la moitié du vêtement est plus clair, ce qu'une personne veut dire par « la
   couleur de cette chemise ».

   OKLab plutôt que CIELAB parce que la teinte d'un bleu y reste en place : dans CIELAB,
   assombrir un bleu fait tourner sa teinte vers le violet de façon visible, et ce fichier
   classe des marines à longueur de journée.

7. **Une couleur, ou deux.** 47 des 442 noms sont bicolores (« Navy/White », « Grey/Lime »),
   et l'un d'eux est « Navy/Navy », ce qui interdit au **nom** de décider. Une pastille unique
   pour un raglan est fausse 47 fois.

   Ce qui ne marche pas : comparer la distance entre deux centres à la dispersion autour
   d'eux. Sur un vêtement éclairé par un dégradé, ce qui est le cas de toute photographie,
   la classification coupe le dégradé en deux, les centres tombent à un quart de la plage de
   part et d'autre du milieu, et le rapport vaut quatre quelle que soit la plage. Le test dit
   « deux couleurs » sur une seule teinture, à chaque fois.

   Ce qui marche : le **creux**. Deux teintures laissent vide le milieu du segment qui les
   joint, parce qu'un vêtement est marine ou il est blanc et que presque aucun pixel n'est à
   mi-chemin. Un dégradé, lui, remplit ce milieu.

   **La marge est mesurée, pas déduite.** Le raisonnement d'origine disait « un dégradé
   uniforme met exactement un tiers de ses pixels dans le tiers du milieu, donc la borne à
   0,12 le refuse par un facteur trois ». C'est faux : la projection va d'un centre à
   l'autre et non d'un bout à l'autre du dégradé, si bien que le tiers du milieu de cette
   projection-là n'est pas le tiers du milieu de la plage. Mesuré en faisant tourner le vrai
   `split()` sur un dégradé d'une seule teinture : 0,158 (marine), 0,164 (gris), 0,167
   (plage étroite). La borne à 0,12 tient donc avec **1,32 fois** de marge, pas trois, et
   c'est ce chiffre-là qui compte le jour où quelqu'un la déplace.

8. **Le recoupement entre photos.** La médiane des primaires, puis les photos qui s'écartent
   de plus de 0,055 sont **retirées** et la médiane est reprise sur celles qui restent. La
   première version refusait tout le coloris dès qu'une photo s'écartait, et jetait
   « Asphalt », « Black Pure » et « Apple Green », qui ont chacun quatre bonnes photos et une
   bizarre. Un coloris n'est refusé que si la majorité ne s'accorde plus sur rien : à ce
   moment-là le nom couvre réellement deux teintures et aucune pastille unique n'est vraie.

---

## 3. Les onze familles

La structure est publiée, les nombres sont mesurés.

Wang, Luo, Kang, Choh et Kim, « An Algorithm for Categorising Colours into Universal Colour
Names », CGIV 2006, pages 426 à 430, ont ajusté des bornes sur 2 916 nominations de 729
échantillons imprimés par dix observateurs, face aux onze termes de base de Berlin et Kay.
Leur modèle est **par étapes**, et l'ordre des étapes est ce qui compte : les achromatiques
d'abord, puis les trois noms qui demandent la clarté et la saturation en plus de la teinte
(brun, rose, jaune), puis le reste par teinte seule. `Swatch::family()` suit cet ordre.

Trois endroits où le modèle publié ne survit pas au contact d'un vêtement.

**Le seuil achromatique.** Le leur est une chromaticité absolue, C\*ab ≤ 5, soit C ≈ 0,014 en
OKLab, et leur valeur de travail plus lâche est 0,030. Mesuré sur ce catalogue : le marine
est à C=0,028 pour L=0,257 et le blanc cassé à C=0,020 pour L=0,909. À 0,014 le blanc cassé
devient un orange ; à 0,030 le marine devient un noir ; et aucune valeur entre les deux ne
marche non plus, parce que leurs clartés diffèrent d'un facteur trois et qu'un nuancier
imprimé ne couvre pas cet écart. La **saturation** les sépare : C/L vaut 0,109 et 0,022. Le
code utilise donc la saturation, qui est la définition classique de CIELUV.

**Mais C/L seul casse du côté sombre**, et c'est le catalogue qui l'a dit. Le rapport laisse
une couleur être chromatique sur de moins en moins de chromaticité à mesure qu'elle
s'assombrit, ce qui est l'inverse du bon sens : une surface d'une chromaticité donnée paraît
**moins** colorée quand elle s'assombrit, pas plus (effet Hunt). « Pitch Black » mesure
C=0,031 pour L=0,118 et sortait bleu ; « Titanium » et « Dark Heather » sortaient bleus à
C=0,018. Le dénominateur est donc plancherisé à **L_SAT = 0,580** : au-dessus, c'est le
rapport classique ; en dessous, c'est la chromaticité absolue sur une échelle fixe.

0,580 est le **centre de la fenêtre où tous les mouvements sont des améliorations**. Sous
0,551 « Pitch Black » reste un bleu ; au-dessus de 0,603 « Ink » (C=0,022 pour L=0,359) cesse
d'être un marine et « Clay » (C=0,024) cesse d'être un beige. Dedans, cinq coloris bougent et
les cinq bougent dans le bon sens.

**Le brun n'est pas une teinte.** Trois arguments indépendants :

- *Colorimétrique.* Le bloc « brown » de Wang et Luo couvre les teintes 20 à 80 en CIELAB,
  ce qui est **entièrement à l'intérieur** de leurs propres plages rouge et orange. Ce qui
  l'en sépare est L\* < 60 et C\*ab ≤ 45, donc la clarté et la chromaticité.
- *Perceptif.* Le brun est une couleur *relative* : elle n'existe pas comme stimulus isolé.
  La même lumière vue seule paraît orange à n'importe quelle intensité, et ne se lit comme
  brune que sombre sur un entourage plus clair, l'œil y voyant alors une surface de faible
  réflectance. Bartleson (1976) a aussi montré que désaturer un stimulus le rend plus brun.
- *Empirique.* Sur les 68 noms de l'enquête couleur xkcd dont le nom de tête est *brown* ou
  *orange* et dont la teinte tombe dans la bande qu'ils partagent, le meilleur seuil unique
  sur la chromaticité en nomme correctement 65 sur 68, et le meilleur seuil unique sur la
  clarté 53. Le code utilise les deux, comme le modèle publié.

**La bande brune est l'arc orange et l'arc jaune**, pas deux nombres de plus. Le brun est un
orange sombre et le kaki un jaune sombre, donc les bords de la bande et sa coupure interne
**sont** ces bornes-là et ne peuvent pas s'en écarter. Le catalogue est d'accord : ses bruns
vont de « Roasted Coffee » (32,8) à « Brown Savana » (63,8) et ses olives de « Moss » (89,6) à
« Urban Khaki » (114,1), donc la coupure à 77,2 tombe dans un trou de 26 degrés. La bande
commençait à 16,0, ce qui rangeait « Cardinal Red » (h=16,4) dans les bruns pendant que
« Deep Red » (h=15,1) restait un rouge.

**Et elle s'arrête à L_CLAIR.** « Délavé à n'importe quelle clarté » faisait un beige de
toute teinte chaude pâle, « Sunshine » et « Amalfi Yellow » compris. Au-dessus de 0,850, une
teinte chaude délavée est une crème et c'est l'arc qui décide : cinq coloris bougent et
aucun beige ne bouge, le plus clair étant « Union Beige » à L=0,838.

Le même raisonnement un cran plus loin sur l'arc donne l'**olive**, que le métier appelle
kaki et range avec les verts : rgb(128,128,0) a **exactement** la teinte du jaune pur pour la
moitié de sa clarté. Seule la clarté peut les séparer.

**Le rose est un rouge clair, et une seule ligne le dit.** Il était dit deux fois : le test
demandait de la clarté, puis les arcs rendaient « rose » à tout magenta sombre de toute
façon, si bien que « Wine » (L=0,395) et « Heather Burgundy » (L=0,442) étaient publiés
roses contre leur propre nom. Le rose a quitté les arcs. La borne en clarté, **mesurée**, est
la plus étroite du fichier : dans la fenêtre de teinte du rose les rouges montent à L=0,487
(« Red/Snowwhite ») et les roses commencent à L=0,493 (« Dark Pink »), six millièmes. La
borne de chromaticité de Wang et Luo n'est **pas** reprise : sur les 41 roses et rouges
étiquetés elle exclut un vrai rose (« Fuchsia Organic », C=0,245) et aucun rouge, le rouge le
plus chromatique (« Fire Red », C=0,237) étant déjà hors de la fenêtre de teinte.

### Les bornes de teinte, ajustées sur les étiquettes du fabricant

La conversion des bornes CIELAB tombait près des **milieux** entre les références sRGB. Un
milieu entre deux primaires n'est pas là où un nom change : l'œil appelle rgb(255,88,0) un
orange alors que sa teinte est plus proche de celle du rouge, et la borne à 40,0 publiait
« Orange », « T. Orange » et « Sunset Orange » comme des rouges.

Chaque borne est donc posée à partir des 300 coloris du catalogue qui portent un mot de
couleur sans ambiguïté **et** assez de chromaticité pour que la teinte veuille dire quelque
chose. Ce sont des échantillons étiquetés : le mot du fabricant sur une teinture qu'il a
faite. Là où les deux populations se séparent nettement, la borne est au milieu du trou et
**rien** n'est mal rangé.

| Borne | Les uns montent à | Les autres commencent à | Posée à |
|---|---|---|---|
| rouge \| orange | 29,16 (Tomato Red) | 31,53 (Sunset Orange) | **30,4** |
| orange \| jaune | 76,16 (Apricot) | 78,28 (Mustard) | **77,2** |
| jaune \| vert | 107,33 (Flo Yellow) | 106,87 (Pixel Lime) | **112,4** |
| vert \| bleu | 197,2 (Emerald Green) | 208,7 (Tropical Blue) | **205,0** |
| bleu \| violet | 276,2 (Navy Pure) | 278,7 (Dark Purple) | **277,4** |
| violet \| magenta | 305,6 (Meta Lilac) | 339,7 (Candy Pink) | **321,0** |

**Une borne n'a pas de trou.** Les jaunes montent à 107,33 et les verts commencent à 106,87
et 108,11 (« Safety Green ») : une seule teinture fluorescente que le métier vend comme un
jaune et comme un vert. Le jaune pur de sRGB, à 109,77, doit rester un jaune, donc la borne
passe entre lui et le premier lime qui n'est pas fluorescent, « Lime » à 114,97. Cela laisse
« Pixel Lime » et « Safety Green » mesurés contre leur nom, et refusés.

**Les huit références sRGB sont un point fixe.** Une borne ajustée sur les teintures d'un
catalogue peut dériver sur une couleur qu'aucun vêtement n'est : une borne jaune/vert à 107,7
séparait parfaitement tous les jaunes fluo de tous les limes de ce catalogue, et appelait
rgb(255,255,0) un vert. Le test `pins the sRGB references` les tient.

Les onze familles, dans l'ordre où le filtre les montre : **Blancs et écrus · Gris · Noirs ·
Beiges et bruns · Rouges · Roses · Oranges · Jaunes · Verts · Bleus · Violets.** Les
neutres d'abord, parce que c'est ce que la plupart des commandes de vêtements de travail
demandent, puis le cercle.

---

## 4. Ce que la mesure refuse de faire

Une couleur qui ne peut pas être mesurée **n'a pas de pastille**. Elle reste dans le filtre,
sous l'intitulé « Non mesurés », avec son nom et son nombre de références, parce qu'un
coloris absent du filtre est une référence qu'un acheteur ne peut plus atteindre. Ce qui est
un échec plus grave qu'une puce sans couleur.

Les refus, et ce qu'ils veulent dire :

| Refus | Ce qui s'est passé |
|---|---|
| `fond non uniforme` | la photo n'est pas un détourage sur fond uni |
| `aucun fond détecté` | le remplissage n'a presque rien retiré : ce n'est pas un détourage non plus |
| `sujet absent ou trop petit` | moins de 3 % du cadre, ou le remplissage a traversé le vêtement |
| `image illisible` | les octets ne se décodent pas |
| `photo non récupérée` | le Worker n'a pas répondu. Ce n'est **pas** un refus : rien n'est écrit sur le coloris, la mesure précédente reste en place et la passe compte le coloris comme *injoignable* |
| `la pastille fournisseur n'est pas une teinte unie` | l'image du nuancier n'est ni un aplat ni deux |
| `ce n'est pas une pastille, c'est un vêtement détouré` | une photo est arrivée dans le champ nuancier |
| `photos discordantes` | aucune majorité ne s'accorde : le nom couvre deux teintures |
| `la photo dit « X », le nom dit « Y »` | voir ci-dessous |

### Le dernier verrou : le nom contredit la photo

`Swatch::name_families()` lit les mots du fournisseur et rend la ou les familles qu'ils
nomment. Ce **n'est pas** un second classificateur et il ne décide jamais d'une famille.
C'est un signal indépendant : quand la photo dit « vert » et que l'étiquette dit « French
Navy », **l'un des deux est faux et on ne sait pas lequel**. Ce peut être un coloris
photographié dans la mauvaise couleur, un nom recopié de la ligne du dessus, ou une borne de
ce fichier réglée à un demi-degré près. Les trois sont réels et les trois finissent pareil :
pas de pastille, et le désaccord au relevé.

Publier la mesure quand même mettrait une puce verte à côté de « Navy » sur un filtre dont
un acheteur se sert pour choisir. Publier la famille du nom serait pire : cela cacherait une
photo cassée pour toujours.

Un nom qui nomme **deux** familles est vérifié contre les deux : « Black/Red » est un raglan
et ses deux teintes mesurées doivent être l'un des deux mots de l'étiquette. Quand la seconde
couleur est trop petite pour être trouvée, la teinte unique mesurée est un gris qui n'est ni
l'un ni l'autre, et c'est exactement le désaccord qu'il faut attraper.

**Les huit désaccords qui restent, nommés.** Après le réglage des bornes, il reste huit
coloris dont la mesure et le nom ne se rejoignent pas, sur 440 mesurés. Ils sont refusés, et
les voici, parce qu'un refus anonyme n'est pas auditable :

| Coloris | Mesuré | Nom dit | Pourquoi c'est indécidable ici |
|---|---|---|---|
| Pixel Lime, Safety Green | jaune | vert | la teinture fluo jaune-vert, vendue sous les deux mots |
| Dusk Rose, Dusty Rose, Millenial Pink, Millennial Pink | brun / rouge | rose | rose poudré pâle et beige se recouvrent ; leur saturation est juste au-dessus de la bande où le nom décide |
| Magenta | rouge | rose | plus **sombre** (L=0,365) que « Heather Burgundy » (L=0,442) qui est vendu comme un rouge, à trois dixièmes de degré de teinte |
| Dark Black/Grey | bleu | noir + gris | nom bicolore mesuré sur une seule teinte |

Aucun n'est corrigé en déplaçant une borne : chacun demanderait de faire passer une borne
**dans** une population étiquetée, donc d'en casser d'autres. La question 49 les pose à
l'associé.

**La liste ne contient que des mots sur lesquels personne ne discute**, et elle a raccourci
au contact du catalogue. « Turquoise », « Aqua », « Teal » et « Petrol » sont entre les verts
et les bleus ; « Coral », « Salmon » et « Peach » entre les roses et les oranges ; « Rust » et
« Terracotta » entre les bruns et les oranges ; « Taupe » et « Slate » entre les gris et tout
le reste ; « Natural » et « Cream » entre les blancs et les beiges. Chacun refusait une mesure
parfaitement bonne pour désaccord avec un mot qui n'a pas de réponse unique. Un contrôle qui
se déclenche sur une opinion n'est pas un contrôle.

---

## 5. Faire tourner la mesure

```
wp teeshoop couleurs mesurer                  # les coloris pas encore mesurés
wp teeshoop couleurs mesurer --recommencer    # tous, quand une IMAGE a changé
wp teeshoop couleurs mesurer --max=20 --photos=3
wp teeshoop couleurs reclasser                # après un changement de BORNE, sans rien retélécharger
wp teeshoop couleurs etat --refus             # ce qui est connu, et ce qui ne l'est pas
wp teeshoop couleurs etat --releve > docs/couleurs.json
wp teeshoop couleurs oublier                  # tout effacer
```

**`reclasser` plutôt que `mesurer --recommencer` quand c'est une borne qui bouge.** La
famille est une fonction pure des triplets OKLab déjà posés sur les termes. Retélécharger
1 900 images fournisseur pour reprendre la même décision coûte dix-sept minutes, et une borne
qui coûte dix-sept minutes à appliquer est une borne qu'on oublie d'appliquer : la boutique
sert alors les familles de la semaine dernière. `reclasser` ne touche jamais à un coloris qui
n'a pas de mesure, et il refuse de relire un coloris bicolore mesuré avant que les deux
triplets soient conservés, parce que ne pas savoir n'est pas refuser.

`--releve` et non `--json` : WP-CLI lit `--json` comme son propre `--format` et refuse la
commande.

Depuis la racine du dépôt, avec le miroir local :

```
npm run couleurs:mesurer
npm run couleurs:relever
npm run verify:couleurs
```

Une fois par semaine suffit : ce que la mesure lit ne change que lorsqu'un vêtement est
rephotographié, et un coloris déjà mesuré est sauté.

**Une panne du Worker n'efface rien.** Une image qu'on n'a pas pu récupérer n'est pas une
couleur qu'on refuse, et le code sait faire la différence (`reachable`) : le terme est laissé
tel quel, compté comme injoignable, et la commande le dit à la fin. Sans cela,
`mesurer --recommencer` lancé pendant une coupure réseau écrivait « photo non récupérée » sur
les 442 coloris, effaçait toutes les pastilles, et la passe suivante les sautait tous pour
cause de « déjà répondu ».

```
0 4 * * 0  cd /home/xxx/public_html && wp teeshoop couleurs mesurer --discret
```

**Pas de cache par image, et c'est une décision mesurée.** `wp_remote_get` rend une image
fournisseur à travers le Worker en 57 ms et `Swatch` la mesure en 26 ms, donc une passe
complète est de l'ordre de quelques minutes et la reprise se fait au **coloris**, qui est
l'unité que quelqu'un relance réellement. Un cache serait une seconde copie de chaque mesure,
indexée par un nom de fichier fournisseur, à invalider le jour où une borne bouge. Ce qu'il
coûte de ne pas l'avoir : trois minutes. Ce qu'il coûte de l'avoir : une pastille périmée que
personne ne sait expliquer.

*(Note pour qui lirait le code : `file_get_contents()` sur une URL met 5 100 ms par photo
dans ce conteneur, contre 57 ms pour `wp_remote_get` et 34 ms pour `Requests::request_multiple`.
Mesuré. C'est le genre de chiffre qui fait croire qu'une conception est impossible.)*

---

## 6. Le relevé et son contrôle

`docs/couleurs.json` est le relevé passable en revue d'une passe : chaque nom de coloris, la
valeur mesurée, la famille, le nombre de photos qui se sont accordées, et pour ceux qui n'ont
pas de pastille, la raison. Il est **commité**, pour qu'un changement de borne dans `Swatch`
apparaisse comme un diff de couleurs et non comme une reclassification silencieuse de quatre
cents d'entre elles.

**Aucune référence fournisseur ne doit y figurer.** Les photos qui ont nourri la mesure sont
à des chemins qui portent les numéros de style du fournisseur, et ce fichier est public dès
que le dépôt l'est. Les **noms** de coloris sont déjà sur chaque fiche produit et ne sont pas
une fuite ; les chemins en sont une, et `Shelf::SEALED` existe pour cette raison.
`scripts/couleurs-guard.mjs` le vérifie plutôt que de faire confiance à ce paragraphe.

Le contrôle **ne compare pas des fichiers, il fait tourner le code** : chaque ligne est
re-décidée par les vrais `Swatch::family_for()` et `Swatch::verify()`, à travers PHP, depuis
l'OKLab stocké de la ligne elle-même. Un contrôle qui réimplémenterait les bornes en
JavaScript serait une seconde copie de la règle et serait d'accord avec lui-même pour
toujours.

**Il lit `lab`, pas `oklch`.** Ce sont la même mesure, l'une exacte et l'autre arrondie pour
être lue par une personne. Lire l'arrondie a fait crier au loup : « Lime » mesure h=114,972
et « Acid Lime » h=114,989, les deux s'écrivent 115,0, et 115,0 était de l'autre côté d'une
borne, si bien que deux coloris étaient signalés en désaccord avec un code qui n'avait pas
bougé. Une alarme qui se déclenche à tort est dépensée la première fois qu'elle a raison. Le
contrôle vérifie à la place que les deux formes se décrivent encore l'une l'autre.

**Trois états, trois formes.** Un coloris que personne n'a regardé est une ligne
`jamais_mesuré`, pas une absence. Il l'était : une passe arrêtée par `--max` ou `--durée`
produisait un relevé de vingt coloris tous mesurés, sur lequel chaque contrôle passait, y
compris le plancher.

Le plancher refuse une passe qui n'a presque rien mesuré : tous les contrôles ci-dessus
passent trivialement sur un relevé où chaque couleur est refusée, et une borne déplacée dans
le mauvais sens produirait exactement cela, quatre cents refus et une coche verte. Le
dénominateur est donc le catalogue entier et non les lignes qui se trouvent être là.

Le contrôle **casse le relevé deux fois exprès à chaque passage** et exige de se voir
attraper : une famille fausse sur un coloris publié, et une passe qui n'a rien mesuré. S'il
n'en attrape pas deux sur deux, il sort en 2 et ne dit pas « propre ».

Ce que porte chaque ligne : `lab` (les triplets exacts, un par teinte), `oklch` et
`saturation` (arrondis, pour l'œil), `pastille` (les hexadécimaux dessinés), `famille`,
`source`, `images`, `ecart_photo` (la distance à la photo de contrôle, quand elle a pu être
mesurée), `ecart_images` (l'écart entre les images d'un même coloris, qui est le seul chiffre
disant à quel point une couleur est **connue**), `articles` (compté maintenant, pas lu dans
`wp_term_taxonomy.count`, que WooCommerce laisse périmé après un import), `nom_dit`, et pour
les refus `refus` et `vue`. En tête, `ecart_max` est exporté depuis `Colours::PHOTO_MAX` pour
que le contrôle n'en garde pas une copie.

---

## 7. Ce que la pastille n'est pas

Ce n'est **pas** une référence de teinture. C'est la valeur que le fabricant **déclare**,
livrée en image plutôt qu'en texte : son nuancier, mesuré. Elle ne dit rien de la matière ni
de la lumière sous laquelle l'acheteur verra le vêtement, et un polyester satiné se
photographie plus clair que le coton teint dans le même bain.

Elle n'est pas non plus d'accord avec la photo du produit par construction : ce sont deux
images différentes, et l'écart entre les deux est **mesuré et enregistré** (`ecart_photo`)
plutôt que supposé nul. Quand aucun nuancier n'est lisible, c'est la photo qui devient la
valeur, et la ligne le dit (`source: photo`).

L'interface le dit là où elle est lue :

> Les pastilles sont mesurées sur les nuanciers du fabricant, ou à défaut sur ses photos, et
> les coloris sont regroupés en onze familles. Elles servent à s'y retrouver, pas à valider
> une teinte : demandez un échantillon avant de lancer une série.

La question 49 de `QUESTIONS-ASSOCIE.md` demande à l'associé s'il dispose d'une source de
valeurs officielles (nuancier Falk&Ross, correspondance Pantone ou RAL). Elle remplacerait la
mesure sans rien changer d'autre.
