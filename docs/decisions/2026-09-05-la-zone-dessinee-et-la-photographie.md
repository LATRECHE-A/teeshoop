# 5 septembre 2026 : la zone est dessinée sur un gabarit, parce que la photographie n'a pas été mesurée

Le brief de la nuit 3 demande, pour la vue simple, « la photographie du vêtement
dans la couleur choisie, avec la zone d'impression dessinée à l'échelle
par-dessus ». Ce document dit pourquoi cette phrase ne peut pas être rendue telle
quelle aujourd'hui, ce qui a été livré à la place, et ce qui manque pour la
rendre vraie.

Deux choses manquent, elles sont indépendantes, et chacune est un relevé et non
une opinion.

---

## 1. La zone mesurée n'existe sur aucun produit

Le brief de la nuit 3 dit que la nuit 2 « a donné à chaque référence une zone
d'impression mesurée ». **C'est faux, et le rapport de la nuit 2 le dit
lui-même** (`docs/nuit-2-a-reprendre.md`, « La zone d'impression : la méthode ne
peut pas aboutir sur ces photographies ») : la machinerie a été construite
(`npm run zones:mesurer`, qui fait tourner le vrai code du studio dans un vrai
navigateur), lancée sur les dix-huit photographies de la gamme, et elle les a
refusées une par une. Sept parce que le torse occupe 85 à 99 % de la silhouette,
sept parce que la ligne de col n'est pas trouvée, quatre parce que le détourage
ne rend pas une forme de vêtement. La cause de fond est que les vues de face du
fournisseur sont des mannequins vivants.

Relevé sur le miroir docker le 5 septembre 2026 :

```
_teeshoop_zone_impression   0
_teeshoop_zone_refus        9
_teeshoop_demi_poitrine    11
_teeshoop_garment          19
_teeshoop_blank_palette     9
```

Zéro zone mesurée, neuf refus enregistrés. `Gamme::apply()` ne recopie de toute
façon que `_teeshoop_demi_poitrine` sur l'offre, pas la zone, et **aucun code PHP
ne lit `_teeshoop_zone_impression`**.

### Ce qui a été livré à la place

`Editeur::zones()` publie `Garments::area_by_size()`, c'est-à-dire la zone
imprimable par face et par taille que porte `data/garments.json`. C'est la
**même source** que `Design::unprintable_sizes` consulte pour refuser une ligne
qu'un film de 33 cm ne peut pas porter. Une seconde source aurait été la faute
que `CLAUDE.md` interdit : le jour où les deux dérivent, le client voit un
rectangle et l'atelier en presse un autre.

Le rectangle est donc **dérivé et vrai en centimètres**, et il est dessiné sur le
gabarit calibré du studio (`src/garments/tee.ts`, `hoodie.ts`), où sa position
est connue. Il n'est pas posé sur la photographie, parce que sa position **sur
cette photographie-là** est exactement le nombre que personne n'a mesuré, et
qu'un placement inventé finit sur un film.

L'écran le dit, sous la photographie :

> Le vêtement, photographié par le fabricant. Le placement est montré sur un
> gabarit à l'échelle : la photographie de cette référence n'a pas été mesurée.

---

## 2. Il n'y a qu'une photographie par référence, pour tous les coloris

Relevé le 5 septembre 2026 sur le produit fournisseur du Gildan Heavy Cotton
(id 96810 sur le miroir), en listant l'image de chaque déclinaison :

```
couleurs = 54        photos distinctes = 1
white      -> /wp-content/uploads/2026/08/5000-2.jpg
off-white  -> /wp-content/uploads/2026/08/5000-2.jpg
natural    -> /wp-content/uploads/2026/08/5000-2.jpg
black      -> /wp-content/uploads/2026/08/5000-2.jpg
sport-grey -> /wp-content/uploads/2026/08/5000-2.jpg
```

Cinquante-quatre coloris, **une** photographie. Le fournisseur n'a pas livré de
vue par coloris, ou l'import ne l'a pas reprise. « La photographie du vêtement
dans la couleur choisie » ne décrit donc rien qui existe dans cette base.

### Ce qui a été livré à la place

La photographie de la référence, une fois, avec sa légende. **La couleur, elle,
est vraie** : la pastille est la mesure prise sur la puce du fabricant
(`Colours.php`, 423 coloris mesurés dont 383 sur une puce), c'est elle qui peint
le gabarit, et c'est le nom du fabricant qui étiquette.

Ce qui a été refusé : teinter la photographie, ou la laisser sous une légende qui
laisse croire qu'elle montre le coloris choisi. `CLAUDE.md` section 7 demande
l'état vide, pas la fiction plausible, et une photographie de t-shirt blanc
présentée comme « Fuchsia » est du contenu fabriqué.

---

## 3. Ce qu'il faut pour rendre la phrase du brief vraie

Dans l'ordre du moins cher au plus cher, et les deux premiers ne sont pas du
code :

1. **Demander au fournisseur des vues à plat, manches écartées.** C'est la
   question ouverte de la nuit 2 (`ACCES-REQUIS.md` §12) et elle débloque la
   mesure de la zone d'un coup : sur les neuf références de la gamme, seul le
   Fruit of the Loom Valueweight en a une.
2. **Demander au fournisseur les vues par coloris**, ou vérifier si l'import les
   a laissées de côté. La question est dans `QUESTIONS-ASSOCIE.md`.
3. Reprendre `scripts/zones-mesurer.mjs` sur les vues à plat. La machinerie
   existe et son contrôle de vraisemblance a déjà intercepté un rectangle faux
   (le B&C ID.333 « mesuré » à 47,5 x 48,6 cm, encolure trouvée entre les deux
   mannequins de la photographie).

Tant que 1 et 2 n'ont pas de réponse, la vue simple restera ce qu'elle est : un
gabarit à l'échelle, une couleur mesurée, une photographie de la référence, et
une phrase qui dit lequel est lequel.
