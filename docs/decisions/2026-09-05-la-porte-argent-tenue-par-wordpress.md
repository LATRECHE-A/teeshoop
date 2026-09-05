# 5 septembre 2026 : la porte de l'argent est tenue par WordPress, et la dette voyage dans l'extension

Décidé et écrit dans la nuit du 5 septembre 2026, par l'agent chargé de la moitié
WordPress du point 4 du brief de la nuit. Chaque nombre cité a été produit en faisant
tourner la chose réelle contre le miroir docker, cette nuit. Ce qui n'a pas pu être
mesuré le dit.

Ce document accompagne `2026-09-05-les-deux-portes.md`, qui porte la décision du
développeur elle-même. Celui-ci ne décide pas si la porte existe : il décide **où elle
est appliquée**, et **comment la dette arrive sur un serveur**.

---

## 1. Le constat, mesuré

Avant cette nuit, la porte de l'argent bloquait une copie de fichiers dans
`scripts/deploiement.sh`. Ce n'est pas l'endroit où l'argent passe. Mesuré sur le
miroir le 5 septembre :

- le portail refusait, et `bacs` était proposé au client comme si de rien n'était ;
- rien dans les 66 fichiers de `includes/` ne lisait `Launch` ;
- un humain pouvait allumer une passerelle dans l'administration, et aucun contrôle
  ne bougeait.

## 2. Décision : trois points d'application, et ils ne se recouvrent pas

| Point | Ce qu'il tient | Ce qu'il ne tient pas |
|---|---|---|
| `woocommerce_available_payment_gateways` | tout moyen de paiement proposé au client | rien : c'est le filet du dessous |
| `pre_update_option_woocommerce_<id>_settings` | l'écriture qui allume une passerelle | une écriture faite avant que WooCommerce ait construit sa liste de passerelles |
| `wp_ajax_woocommerce_toggle_gateway_enabled`, priorité 1 | l'interrupteur de la liste des passerelles, pour que le contrôle revienne en arrière au lieu de tourner | rien de plus que le précédent : il existe pour l'opérateur, pas pour la garantie |

**Pourquoi un seul crochet ne suffisait pas.** Lu dans le code livré de WooCommerce
11.0.1 : `WC_AJAX::toggle_gateway_enabled()` (ligne 4146) appelle
`$gateway->update_option('enabled','yes')` **sans aucun filtre à l'intérieur**. Les
deux chemins d'écriture, `WC_Settings_API::update_option()` (ligne 197) et
`process_admin_options()` (ligne 238), passent en revanche tous les deux par
`apply_filters( 'woocommerce_settings_api_sanitized_fields_' . $id, ... )`. Le crochet
choisi est `pre_update_option_<option>`, un cran plus bas, parce qu'il attrape en plus
une écriture qui n'est jamais passée par `WC_Settings_API`.

**Pourquoi les noms d'options sont exacts et non un motif.** Les méthodes de livraison
sont aussi des `WC_Settings_API` et leurs options s'appellent pareil. Refuser d'activer
un mode de livraison parce qu'un produit n'a pas de textile nu serait absurde. Les
filtres sont donc posés depuis la liste des passerelles, sur `wc_payment_gateways_initialized`,
exactement comme WooCommerce pose les siens dans `on_payment_gateways_initialized()`.

## 3. Décision : le garde d'activation ne lit PAS l'état de la passerelle

C'est la différence entre une porte et une impasse. « Aucun moyen de paiement n'est
actif » est un refus légitime de la porte de l'argent, et il est vrai de toute boutique
qui n'en a jamais allumé un. Un garde qui le lirait interdirait pour toujours l'action
qui le lève, et la seule sortie serait de modifier la base à la main.

`Launch::activation_blockers()` retire donc les refus de clé `paiement` et garde les
autres : un produit qu'on ne peut pas approvisionner et une colonne vendue sous son
plancher sont vrais qu'il existe une passerelle ou non, et ce sont eux qui ne doivent
pas être en ligne à la seconde où une carte se met à fonctionner.

## 4. Décision : le plancher est LU, jamais recalculé

Le plancher d'une colonne est la réponse de `Costing` sur une commande réelle. La
mesure existe : `tests/integration-grille.php`, une commande par colonne publiée. Elle
prend des minutes et crée des commandes ; aucune page ne peut la refaire à la demande.

Le harnais **enregistre donc son verdict** (`teeshoop_plancher_grille`) et `Launch` le
lit. Une deuxième version moins chère de la même règle serait la seconde implémentation
que `CLAUDE.md` interdit, et les deux divergeraient la première semaine où un
fournisseur bouge un prix.

Quatre états refusent, et trois portent sur l'enregistrement plutôt que sur le prix :

- **absent** : personne n'a jamais mesuré. « On n'a pas pu regarder » n'est pas « tout
  va bien ». C'est l'état du miroir cette nuit, et c'est un refus.
- **périmé** : plus vieux que 30 jours.
- **dépassé** : le tarif publié a changé après la mesure, donc elle décrit des prix que
  la boutique ne pratique plus. Détecté par une signature du tarif, pas par une date.
- **sous le plancher** : la mesure a trouvé des colonnes en dessous.

**Trente jours, et voici d'où vient ce nombre.** Le côté recette est attrapé
immédiatement par la signature. Le côté coût bouge sans nous : une grille fournisseur,
un tarif de film, une tranche Colissimo. Rien dans WordPress ne voit ces trois-là
changer, donc le seul instrument honnête qui reste est un âge. Trente jours est le pas
du plus lent des trois, et c'est assez court pour qu'une boutique ne passe pas un
trimestre à vendre sous un coût que personne n'a remesuré.

**Ce que ça coûte, et il faut l'écrire.** Sur toute boutique qui n'a jamais lancé
`npm run verify:grille`, y compris le miroir, la porte refuse et aucun moyen de
paiement n'est proposé. Ce n'est pas une régression, c'est le contrôle qui fonctionne,
mais un harnais qui va jusqu'au paiement (`scripts/wp-e2e-verify.mjs`) échouera tant
que la mesure n'existe pas. La mesure n'a pas pu être prise cette nuit : elle demande
le Worker de `teeshoop_settings.worker_url`, qui n'écoute pas sur cette machine
(`cURL error 7 ... host.docker.internal:8788`). C'est nommé dans le rapport de nuit.

## 5. Décision : la dette voyage dans l'extension, et l'écran en dérive la moitié

Le brief demande `docs/DETTE-LANCEMENT.md` affiché dans l'administration WordPress. Le
déploiement ne transporte que `wp-plugins/` et `wp-themes/` : `docs/` n'arrive jamais
sur un serveur, et sur la production ce chemin n'existe pas et n'existera pas.

Les deux réponses possibles sont prises toutes les deux, séparées par ce que chaque
côté sait réellement.

**Re-dérivée, la moitié vivante.** Ce que la BOUTIQUE peut prouver d'elle-même est
demandé à `Launch`, la même autorité que lit le portail. Jamais périmée, aucun fichier,
et elle ne peut pas contredire le script de déploiement. La recopier dans un document
créerait la seconde implémentation interdite.

**Copiée, la moitié suivie.** Le propriétaire nommé de chaque ligne, la date, les
lignes de registre : rien de tout ça n'existe dans WordPress et aucun code ne peut le
dériver. C'est écrit une fois, dans le dépôt, et ça voyage comme un fichier.

Le fichier va dans `wp-plugins/teeshoop-core/data/dette-lancement.md`, **les mêmes
octets** que `docs/DETTE-LANCEMENT.md`, produits par la même commande :

```
TEESHOOP_DETTE=wp-plugins/teeshoop-core/data/dette-lancement.md \
  node scripts/launch-gate.mjs --porte=publication
```

Trois raisons de choisir ce répertoire plutôt qu'un autre :

1. C'est déjà là que l'extension porte ses projections de faits du dépôt
   (`data/hypotheses.php`, écrit par `scripts/hypotheses-guard.mjs --write`). Le motif
   existe, il est documenté, et il est déjà déployé.
2. Le `.htaccess` de la racine de l'extension refuse déjà `*.md` et `*.json`. Mesuré
   cette nuit sur le miroir, sur le fichier réel :
   `GET /wp-content/plugins/teeshoop-core/data/dette-lancement.md` rend **403**, comme
   `README.md`. Le miroir est Apache 2.4 ; o2switch est LiteSpeed, qui implémente la
   même sémantique, et ça n'a **pas** pu être vérifié cette nuit faute d'accès SSH.
3. Ce sont les mêmes octets que ceux que la CI imprime, donc personne n'a à faire
   confiance à une transformation. L'écran les rend tels quels, dans un bloc, sans
   moteur Markdown : il ne sait pas quelle forme le document a pris, et un rendu à
   moitié écrit qui abîme un tableau vaut moins que le texte.

**L'état « le fichier n'est pas là » est dessiné**, pas blanc : il dit que ce n'est pas
« il n'y a pas de dette », et il nomme la commande qui écrit le fichier et le fait que
seule la copie de l'extension voyage.

**Ce qui reste à faire et qui n'est pas dans ce périmètre** : que la commande ci-dessus
tourne toute seule. Une ligne dans `scripts/launch-gate.mjs` (une seconde écriture
après la première) ou une invocation de plus dans le déploiement. Tant que ce n'est pas
fait, la copie est régénérée à la main, et l'écran dit sa date d'écriture pour que
personne ne la prenne pour un relevé du jour.

## 6. Ce qui a été prouvé, et comment

- La suite d'intégration WooCommerce passe de **241 à 252 cas**, tous verts
  (`npm run test:wp`, 3 min 10 s).
- Les deux points d'application ont été **cassés exprès** dans la même exécution :
  quatre cas sont passés au rouge, nommément ceux qui les couvrent, puis tout est
  revenu vert après remise en état. La sortie est dans le rapport de nuit.
- La porte a été montrée **en train de refuser une activation réelle** sur le miroir,
  par le chemin que WooCommerce emprunte lui-même, puis en train de l'autoriser une
  fois les deux conditions réellement levées, puis le miroir a été remis exactement
  dans l'état où il a été trouvé.
