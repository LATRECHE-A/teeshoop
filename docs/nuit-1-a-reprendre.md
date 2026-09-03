# Nuit 1, ce qui reste à reprendre

> Écrite à la fermeture de la nuit du 3 septembre 2026. Tout chiffre ici a été
> produit en faisant tourner la chose réelle, contre le miroir docker ou contre
> la vraie préproduction. Ce qui n'a pas été mesuré le dit.

---

## 1. L'état des lieux, avant et après

| | Avant | Après |
|---|---|---|
| Le miroir docker | **chaque page du thème rendait 200 avec zéro octet** | l'accueil rend 46 683 octets |
| `<img>` sur l'accueil du miroir | **0** | **6** |
| `<img>` sur l'archive boutique | 24 pour 24 fiches | 25 pour 24 fiches |
| tuiles « Sans photo » visibles | 1 sur l'accueil | **0** |
| Couleur de marque | `#1f4fd8`, inventée | `#010050`, relevée sur son logo |
| Police | Inter, inventée | Urbanist 600/700 et Lato 400/700, les siennes |
| Logo | aucun, le nom du site en texte | le sien, sur `custom-logo` |
| `og:image` | **aucune, sur aucune page** | déclarée, dimensions lues dans le fichier |
| Icône de site | aucune | sa marque orange sur son navy |
| Rayons dans la barre | 2 sur 3 stockés | tous ceux qui ont des produits |
| Travaux Action Scheduler en attente | **96 259** | 18, puis gelés par un garde-fou |
| Base du miroir | 302,8 Mo | 232,2 Mo |

## 2. Ce qui n'est pas fini, nommément

### L'import du catalogue tourne encore

`--famille=all` planifie **2 303 références** et l'avancement était de
**421/2303, zéro en échec**, à 23 h 06. Une tranche de 30 minutes en traite
entre 220 et 420 selon la proportion de créations. Le pilote (dans le
scratchpad, non suivi en git) tourne encore à la fermeture.

**TROIS PILOTES, DEUX MAUVAIS SIGNAUX, et c'est la partie à retenir.** Le
premier a brûlé cinq tranches en treize secondes le soir où le Worker était à
terre, et a fait marquer 2 043 références « en échec » pour cette seule raison ;
il vérifie maintenant le Worker avant chaque tranche. Le second s'est arrêté
après UNE tranche en annonçant « TERMINE », sur deux lectures fausses de
`teeshoop catalogue etat` :

  Liste complète   : oui        <- les 2 303 ont été ÉNUMÉRÉES, pas traitées
  Terminé          : en cours   <- un grep « Terminé  » matche cette ligne

Le seul signal fiable est **`Avancement : X/Y` avec X égal à Y**. C'est ce que
le troisième lit, et il l'affiche avant et après chaque tranche pour qu'un
arrêt prématuré se voie dans le journal.

Relevé à 22 h 54 le 3 septembre, contre le miroir :

| | au réveil du miroir | à la fermeture |
|---|---|---|
| produits publiés | 465 | **734** |
| brouillons | 0 | 4 (dont 2 sans photographie fournisseur) |
| déclinaisons | 26 359 | **28 946** |
| pièces jointes | 735 | **1 122** |
| base | 302,8 Mo | 247,5 Mo |
| produits fournisseur sans photo | non mesuré | **0** |

**Pour le relancer** : le Worker local doit tourner (`npx wrangler dev --port
8788`), et `teeshoop_settings.worker_url` doit pointer dessus, sinon l'import
refuse chaque référence, ce qui est le bon comportement et non une panne. C'est
arrivé cette nuit : cinq tranches ont été brûlées en treize secondes et 2 043
références marquées « en échec » pour cette seule raison.

### La préproduction a le code mais pas le catalogue

Le code est déployé et vérifié octet pour octet (`cmp` sur `tokens.css`,
`fonts.css`, `header.php` et le logo). Le logo et ses dix photographies de rayons
y sont posés.

Ce qui manque : **ses 6 produits publiés sont des restes de démonstration** sans
photographie (« Tapis d'acupression violet », « T shirt Imperial Exemple »),
donc son archive boutique affiche 6 tuiles « Sans photo ». Aucun n'est un produit
du catalogue fournisseur : ils ne portent pas `_teeshoop_ref`.

**Ce qu'il faut pour y remédier** : y faire tourner l'import, ce qui suppose de
poser `TEESHOOP_CATALOGUE_TOKEN` sur cette installation, donc de faire tourner le
jeton du Worker, qui est **le même Worker que celui de la production**. Cette
nuit s'y est refusée : voir `ACCES-REQUIS.md` §6 decies B, qui donne les trois
commandes dans l'ordre.

### Deux questions pour l'associé

`QUESTIONS-ASSOCIE.md`, Q62 (Lato ou Work Sans pour le texte courant) et Q63 (ses
polices partent chez Google sur chaque page, ce qui est un vrai risque RGPD sur
son site actuel).

### Un jeton à faire tourner, et c'est notre faute

`wp config set` **affiche la valeur qu'il écrit**. Le jeton de développement
s'est donc retrouvé dans la transcription de la séance. `ACCES-REQUIS.md`
§6 decies B donne la rotation, et le correctif est `--quiet`, qui est déjà la
forme utilisée au §4 du même document.

## 3. Ce qui a été trouvé en chemin et qui n'était pas le sujet

**`mockup-shots.mjs` ne rend plus qu'une vue.** Il échoue à la deuxième sur
« Execution context was destroyed, most likely because of a navigation », et sa
seule sortie est une mire de calibration en pouces. Il quitte bien avec le code
1 : c'est le harnais qui est cassé, pas sa porte.

**Le réglage `woocommerce_attribute_lookup_enabled` n'arrête pas ce qu'on croit.**
Il gouverne la LECTURE de la table, pas la mise en file des mises à jour. Détail
et mesures dans `docs/decisions/2026-09-03-catalogue-rayons-et-photos.md` §4.

**Le studio ne s'affichait pas en local**, et pour deux raisons empilées : le
réglage `studio_origin` du miroir pointe sur un port que rien ne servait, et le
jour où on y met le Worker, sa politique de sécurité refuse d'être encadrée
parce que `SHOP_ORIGINS` ne contient aucun `localhost`. Contourné cette nuit par
`wrangler dev --var SHOP_ORIGINS:"… http://localhost:8080"`, qui est local et ne
touche à aucun réglage livré. À traiter proprement une autre fois.

## 4. Les gardes ajoutés, et la façon de les casser

| Garde | Ce qu'il refuse | Prouver qu'il sait échouer |
|---|---|---|
| `npm run verify:acces` | rien : il MESURE et écrit `docs/etat-acces.json` | `--self-test` (port fermé contre hôte inexistant) |
| `npm run verify:fonts` | un poids demandé et non livré, une dérive d'un woff2, une adresse Google, une licence absente, un préchargement mort | `--self-test`, onze cas |
| `npm run verify:vitrine` | moins de 400 produits, un produit fournisseur sans photo, un accueil sans image, une archive avec moins d'images que de fiches, une tuile « Sans photo » rendue, une og:image en 404 | `--self-test`, neuf cas |
