# Nuit 1, ce qui reste à reprendre

> Écrite à la fermeture de la nuit du 3 septembre 2026. Tout chiffre ici a été
> produit en faisant tourner la chose réelle, contre le miroir docker ou contre
> la vraie préproduction. Ce qui n'a pas été mesuré le dit.

---

## 1. L'état des lieux, avant et après

| | Avant | Après |
|---|---|---|
| Le miroir docker | **chaque page du thème rendait 200 avec zéro octet** | l'accueil rend 46 683 octets |
| Produits publiés | 465 | **2 309** |
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

### L'import est fini, et il a découvert le travail de la nuit 2

Terminé le 4 septembre à 3 h 00, en 8 tranches et 13 937 s : **2 303 références
sur 2 303, zéro en échec**. 1 630 créées, 601 modifiées, 70 inchangées, 2 sans
article, 42 143 déclinaisons écrites, **2 450 photographies copiées**.

| | au réveil du miroir | à la fin |
|---|---|---|
| produits publiés | 465 | **2 309** |
| déclinaisons | 26 359 | **46 594** |
| pièces jointes | 735 | **3 502** |
| produits fournisseur sans photographie | non mesuré | **0** |
| base | 302,8 Mo | 342,7 Mo |

**C'EST FAIT, LE 4 SEPTEMBRE.** « Autres textiles » est passé de **1 744 à 236**
et la barre de navigation de 2 rayons à 11 :

| Rayon | Produits |
|---|---|
| Sacs & tote bags | 500 |
| Vestes | 393 |
| Casquettes | 379 |
| Autres textiles | 236 |
| Sweats | 195 |
| Bonnets | 122 |
| Chemises | 100 |
| Tabliers | 44 |
| Maison | 43 |

Le classement est DÉRIVÉ du vocabulaire du fournisseur (`style_product_group_list`,
que le Worker jetait) et jamais du titre. Il vit dans un SECOND champ, `FrShelf`,
parce que `FrKind` atteint le prix plancher via `PriceRule`. Détail complet et
chiffres dans `docs/decisions/2026-09-03-catalogue-rayons-et-photos.md` §5.

Il reste **7 bonnets dans Casquettes** sur 2 309 produits, tous des cas où le
fournisseur lui-même ne distingue pas. Zéro gant et zéro écharpe vendus comme
couvre-chefs, ce qui était le vrai risque.

**Pour relancer un import** : le Worker local doit tourner (`npx wrangler dev
--port 8788`) et `teeshoop_settings.worker_url` doit pointer dessus, sinon
l'import refuse chaque référence, ce qui est le bon comportement et non une
panne.

**TROIS PILOTES, DEUX MAUVAIS SIGNAUX.** Le premier a brûlé cinq tranches en
treize secondes quand le Worker était à terre, faisant marquer 2 043 références
« en échec » pour cette seule raison. Le second s'est arrêté après UNE tranche
en annonçant « TERMINE », sur deux lectures fausses de `catalogue etat` :

    Liste complète   : oui        <- les 2 303 ont été ÉNUMÉRÉES, pas traitées
    Terminé          : en cours   <- un grep « Terminé  » matche cette ligne

Le seul signal fiable est **`Avancement : X/Y` avec X égal à Y**.

### Le Worker et l'extension doivent partir ENSEMBLE, et je n'ai déployé ni l'un ni l'autre

Le classement en rayons est écrit des deux côtés : le Worker calcule le rayon,
l'extension le traduit en catégorie. **Livrer une moitié sans l'autre range tout
le catalogue dans « Autres textiles »**, ce qui est le repli voulu et signalé
dans le rapport d'import, mais c'est quand même une boutique cassée.

Je n'ai pas déployé le Worker cette nuit, et c'est délibéré : `wrangler deploy`
touche le Worker UNIQUE qui sert aussi la production, et le brief de la nuit 1
interdit de toucher à la production. Le changement est purement additif (un
champ de plus dans le JSON) et testé, mais ce n'est pas à moi de le décider un
soir où la consigne est de ne rien y toucher.

**Donc, dans cet ordre, quand quelqu'un le décidera :**

```
npm run deploy                      # le Worker, partagé avec la production
./scripts/deployer.sh preprod       # l'extension et le thème
```

Et si l'ordre est inversé, rien n'est perdu : l'extension sans le Worker range
dans le fourre-tout et l'écrit dans son rapport, ligne par ligne.

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
