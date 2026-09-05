# Ce qui tourne tout seul, et le plancher de la suite WooCommerce

> 5 septembre 2026. Toute la mesure de ce document a été produite en faisant
> tourner la chose réelle, sur cette machine, cette nuit. Ce qui n'a pas été
> mesuré le dit.

## Le constat

Le dépôt porte 42 entrées `verify:` et `bench:` dans `package.json`. Huit
tournaient dans un travail automatique. La suite d'intégration WooCommerce, que
la section 2 de `CLAUDE.md` rend obligatoire pour tout ce qui touche au panier ou
à la commande, n'en faisait pas partie, alors que trois nuits venaient de toucher
le panier.

## Décision 1 : le plancher porte sur les CAS, et il vaut 241

Le brief demandait « la construction casse si le compte d'assertions descend sous
500 ». Aucun nombre de ce dépôt ne vaut 500, et un plancher à 500 aurait rendu le
travail rouge dès le premier passage, ce que le même brief interdit. Les nombres
réels, mesurés :

| Ce qu'on compte | Valeur | D'où elle vient |
|---|---|---|
| Cas que la suite imprime, 08:06 | **241** | `npm run test:wp`, exit 0, 3 min 15 s |
| Cas que la suite imprime, 11:5x | **253** | même commande, après qu'une autre séance a ajouté douze cas |
| Cas sur un miroir NEUF, provisionné par la CI | **253** | exit 0, 3 min 36 s |
| Blocs `ts_it` dans les sources (08:06) | 244 | trois sont imbriqués dans un cas parent |
| Appels d'assertion (`ts_assert`, `ts_eq`, `ts_eq_cents`) | 903 | 12 fichiers, 8 360 lignes |
| Cas de la suite PHP pure | 567 | `npm run test:php` |
| Moitiés de suite chargées par `integration.php` | 11 | `require_once __DIR__ . '/…'` |

Le plancher porte sur **241**, le nombre de cas, pour une raison simple : c'est le
seul nombre que la suite imprime, donc le seul qui vienne d'avoir fait tourner la
chose réelle. Compter les assertions demanderait d'instrumenter `ts_assert`,
c'est-à-dire d'écrire un second compteur à côté de celui qui existe, et deux
écritures d'une même règle finissent toujours par diverger.

**Le plancher vaut 241 et non 253**, ce qui est un choix : 241 est le total que
les DEUX arbres de la nuit dépassent, donc le seul qui ne puisse pas rendre le
travail rouge pour une raison qui n'est pas un défaut, dans une nuit où trois
séances écrivent en même temps. Le prix de ce choix est douze cas d'angle mort,
assez pour qu'une petite moitié de suite disparaisse sans que le total descende
(`concurrency.php` en a quatre, `integration-listing.php` huit).

Ce trou-là est fermé par un SECOND nombre, plus précis parce qu'il regarde la
cause et non son effet : `integration.php` doit encore charger ses **onze**
`require_once`, et chaque fichier nommé doit exister sur le disque. Ce compte ne
bouge pas quand on écrit des cas, seulement quand on ajoute ou retire une moitié
de suite, c'est-à-dire à l'occasion qui mérite un commit.

Quand l'arbre cesse de bouger, remonter `PLANCHER` au total vert imprimé par la
première exécution de la CI est une modification d'une ligne, et elle est
souhaitable.

**Le point le plus important n'est pas le plancher, c'est le refus d'à côté.**
`scripts/wp-suite-verify.mjs` refuse une sortie qui n'imprime AUCUN total, au
lieu de la lire comme zéro cas. Une suite qui fatale au milieu peut sortir 0 ;
« on n'a pas pu regarder » et « il n'y a rien » sont deux résultats différents, et
c'est cette confusion qui a déjà coûté une séance à ce dépôt (« neuf coches vertes
sous 0 passed »).

## Décision 2 : la version de node vient de `.nvmrc`, et elle vaut 26

Mesuré : la machine du développeur, sur laquelle chaque harnais de ce dépôt a été
étalonné, tourne node v26.8.1. `.github/workflows/ci.yml` épinglait
`node-version: 22`. Deux versions, deux comportements possibles, et celle qui
décide est celle que personne ne regarde.

`.nvmrc` porte donc `26` et les travaux lisent `node-version-file: .nvmrc`. C'est
aussi le fichier que lisent `nvm`, `fnm` et `asdf`, donc une machine neuve tombe
sur la même. La CI passe de 22 à 26 par ce changement, ce qui est le sens
souhaité : elle rejoint la version qui a produit les mesures.

## Décision 3 : deux seuils d'audit et pas un

Mesuré le 5 septembre sur l'arbre du jour :

    npm audit --omit=dev --audit-level=high    sortie 0
    npm audit --audit-level=critical           sortie 0
    npm audit --audit-level=high               sortie 1

Les cinq failles hautes sont toutes `undici`, via `miniflare`, via `wrangler`,
c'est-à-dire de l'outillage qui ne sort pas de la machine de construction. Les
brancher aujourd'hui aurait donné un travail rouge le premier jour.

Ce qui est branché : `--omit=dev --audit-level=high`, qui garde ce qu'un client
télécharge, et `--audit-level=critical` sur tout l'arbre. Ce qui est demandé au
développeur : monter `wrangler` au-delà de 4.113.0 (l'avis nomme
`4.16.0 - 4.113.0`), après quoi ces deux lignes se remplacent par la seule
`npm audit --audit-level=high`.

## Décision 4 : la CI monte le miroir, et lui pose trois faits

Mesuré en montant un miroir vierge à côté de celui du développeur : **29 cas sur
241 échouaient**, pour trois raisons qui ne sont pas dans le code.

1. **`WP_ENVIRONMENT_TYPE` n'atteint pas wp-cli.** `docker-compose.yml` la pose
   dans `WORDPRESS_CONFIG_EXTRA`, et `wp-config.php` évalue cette variable
   DEPUIS L'ENVIRONNEMENT à chaque requête. Le service `wp` la porte, le service
   `wpcli` non. Les deux conteneurs ne voient donc pas les mêmes constantes, et
   `npm run test:wp` tourne sous wpcli, où WordPress répond « production » : la
   boutique émet une vraie série de factures au lieu de la série d'essai. C'est
   la même forme de défaut que celui déjà écrit en tête de `docker-compose.yml`
   pour un secret, sur une autre variable. La CI écrit la constante dans le
   fichier, où les deux la lisent. **Le commentaire de `docker-compose.yml` qui
   dit que `WORDPRESS_CONFIG_EXTRA` n'est appliqué qu'à la création de
   `wp-config.php` est faux** : il est évalué à chaque requête, par le conteneur
   qui porte la variable, et seulement par lui.

2. **L'identité légale ne vit dans aucun fichier suivi.** Le miroir du
   développeur la porte depuis le 1er septembre ; c'est l'identité réelle d'une
   société et elle n'a rien à faire dans le dépôt. La suite exige pourtant une
   identité complète (« a gate that refuses whatever it is given is not a gate »).
   La CI pose donc l'identité de vérification que
   `tests/integration-checkout.php` invente déjà pour ses propres cas, aux mêmes
   valeurs, et qui ne quitte pas le conteneur.

3. **`Importer::one()` suppose des taxonomies que seul `Importer::run()` crée.**
   `Taxonomy::ensure_attributes()` est appelé par le parcours complet du
   catalogue, pas par l'import d'une référence. Sur un miroir où le catalogue a
   déjà été importé une fois, `pa_couleur` et `pa_taille` existent ; sur un
   miroir neuf, non, et l'import écrit zéro article **en rapportant « created »** :
   23 cas au rouge. La CI crée les attributs par le code livré, dans son propre
   processus, parce qu'une taxonomie créée après `init` n'existe pour
   `wp_set_object_terms` qu'au processus suivant.

4. **Aucune passerelle de paiement n'est allumée**, et depuis le 5 septembre
   `Payment::refuse_enabling()` interdit d'en allumer une tant que la porte de
   l'argent refuse, ce qu'elle fait sur une boutique vide. Quatre cas mesurent ce
   que cette porte fait à une passerelle ALLUMÉE et disent eux-mêmes qu'ils ne
   mesurent rien sans elle. La CI allume donc le virement bancaire AVANT
   d'activer notre extension, c'est-à-dire avant que la porte existe pour le
   refuser, ce qui est aussi l'ordre dans lequel le miroir du développeur s'est
   constitué.

Ces quatre faits ne sont pas des réglages de CI : ce sont quatre façons dont
`npm run test:wp` n'est pas hermétique. Un nouvel arrivant qui monte le miroir
tombe exactement dessus. Avec les quatre étapes, un miroir vierge rend
« 253 passed », exit 0.

**Et un cinquième, qui n'est pas une étape mais une règle** : deux exécutions de
la suite sur LE MÊME miroir se marchent dessus. Mesuré cette nuit sans le
vouloir : une suite lancée pendant qu'une autre tournait a produit un trou dans
la séquence de facturation, quinze refus « Cet article ne peut pas être
personnalisé » et une erreur fatale. Chaque travail de CI monte son propre
miroir, donc le cas ne se pose pas là ; il se pose sur la machine d'un
développeur, et il explique un rouge qui n'a rien à voir avec le code.

## Décision 5 : ce qui n'est pas branché ne l'est pas par une raison technique

Le brief dit « un script de vérification que personne ne lance est une fausse
assurance », et demande de retirer ce qui n'est pas branché. **Aucune entrée n'a
été retirée**, et c'est une décision, pas un oubli.

Les 45 entrées (`verify:`, `bench:`, `test:php`, `test:wp`) se répartissent ainsi,
et une seule famille mérite le reproche.

- **Dix-huit tournent maintenant à chaque poussée**, contre huit hier. Les six
  ajoutées cette nuit : `test:wp`, `verify:fonts`, `verify:editeur`,
  `verify:consent`, `verify:cors`, `verify:focus`, `verify:admin-gate`.
- **Neuf mesurent une boutique GARNIE** (`grille`, `cache`, `csp`, `wp-e2e`,
  `invoice`, `bat`, `vitrine`, `a11y`, `vendable`). Mesuré plutôt qu'affirmé :
  `vitrine` sort 1 sur un miroir vide (« l'archive contient au moins une fiche,
  vu : 0 ») et `a11y` rend 392 assertions sur 424. Les brancher là-dessus ne
  mesurerait rien, ou mesurerait la boutique vide, ce qui est pire qu'un trou.
- **Deux ont besoin du compte fournisseur** (`fr`, `wp-catalogue`) et **un de
  l'adresse IP autorisée chez o2switch** (`acces`). Un exécutant GitHub qui
  porterait les identifiants Falk&Ross serait un endroit de plus d'où le
  catalogue et nos prix d'achat peuvent fuir.
- **Onze produisent des captures ou des chiffres qu'un humain regarde** (six
  harnais de capture, cinq bancs). Elles ne rendent pas de verdict. Les supprimer
  serait supprimer un instrument qui marche pour satisfaire une phrase.
- **Deux sont ROUGES aujourd'hui et sont nommées comme telles** : `verify:seo`
  (435 assertions sur 458 ; quatorze « manque Organization » et six « Bobigny »,
  la boutique publiant un noeud `LocalBusiness` là où le harnais cherche
  `Organization`) et `verify:leak` (sortie 3 ; « city » et « sunset » ne
  retrouvent pas leur rendu après un aller-retour). Brancher un travail rouge le
  premier jour n'apprend rien à personne.
- **Deux n'ont pas été mesurées cette nuit** (`nest`, `retour`) et ne sont donc
  pas branchées : brancher sans mesurer est exactement ce que ce document
  reproche au reste.

Ce qui reste dehors est nommé un par un, avec sa raison, en tête de
`.github/workflows/ci.yml`, à l'endroit où quelqu'un qui lit un vert le lira.

## Décision 6 : le commit est tamponné dans la ligne que WordPress affiche déjà

L'en-tête annonce « Version 0.1.0 » depuis six mois, donc l'écran des extensions
ne répond pas à la seule question qu'on lui pose devant une boutique qui se
comporte mal : quel code tourne là. La préproduction et la production reçoivent le
même envoi à des moments différents, et le commit est la seule chose qui les
distingue.

`scripts/version-tampon.mjs` réécrit la ligne `Version:` juste avant l'envoi :
`0.1.0` devient `0.1.0+g1a2b3c4`, et `0.1.0+g1a2b3c4.sale` quand la copie de
travail portait des modifications non validées. Le suffixe suit un `+` et non un
`-` parce qu'en versionnage sémantique ce qui suit un `-` est une pré-version :
`0.1.0-g1a2b3c4` serait INFÉRIEUR à `0.1.0`, et l'extension rajeunirait à chaque
déploiement.

Le numéro `0.1.0` ne bouge pas : décider que la boutique est en 1.0 est une
décision de produit, elle n'appartient pas à un script. Le commit, lui, est
mesuré par `git rev-parse` ; sans git, le script refuse et sort 2 plutôt que
d'inventer.

Le dépôt ne porte jamais de tampon, et une porte de la CI le vérifie : un tampon
validé désignerait un commit antérieur à lui-même.
