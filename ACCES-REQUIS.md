# Accès et secrets : la liste complète

> Objectif de ce document : que je ne sois **jamais bloqué** faute d'un accès.
> Il est ordonné par ce qui bloque le plus tôt. Chaque ligne dit *pourquoi* l'accès
> est nécessaire. Si la raison ne tient pas, l'accès ne doit pas être donné.
>
> Dernière mise à jour : 1er septembre 2026 (§6 sexies, les réponses de l'associé) · voir aussi [QUESTIONS-ASSOCIE.md](QUESTIONS-ASSOCIE.md)

---

## État actuel

| Accès | État | Ce qu'il débloque |
|---|---|---|
| Dépôt GitHub `LATRECHE-A/teeshoop` | ✅ en place | Le code, la CI |
| Cloudflare (Worker + R2) | ✅ en place | Le studio, le proxy fournisseur |
| Falk & Ross (API web service) | ✅ en place | Catalogue, stock, prix d'achat |
| `ADMIN_TOKEN` sur le Worker | ✅ posé le 12/08 | La console atelier |
| SSH o2switch | ✅ **posé et vérifié le 14/08** | Tout le travail WordPress |
| Préproduction (WP Tiger) | ✅ **créée et vérifiée le 14/08** | Tester sans toucher la boutique |
| cPanel o2switch (interface web) | ✅ sans objet, voir §2 | Rien qui ne passe déjà par SSH |
| Compte admin WordPress | ✅ confirmé le 14/08 (`LTHAbdou`, ID 30) | Réglages Woo, pages, extensions |
| Clés API WooCommerce | ✅ **posées et vérifiées le 14/08** | Produits, commandes par script |

**Plus rien ne manque.** Au 14 août 2026, tous les accès nécessaires au développement
et au déploiement sont en place et ont été **essayés, pas supposés** : chaque ligne
verte ci-dessus correspond à une commande réellement passée contre le vrai serveur,
consignée dans les sections qui suivent.

Ce qui reste à obtenir n'est plus un accès mais **des réponses** : celles de l'associé
dans [QUESTIONS-ASSOCIE.md](QUESTIONS-ASSOCIE.md), dont la TVA (constat 6), qui est
légale et bloquante.

**Les clés Stripe de test sont arrivées le 1er septembre 2026** et sont posées hors du
dépôt. Elles ont été essayées, pas supposées : un paiement de test de 14,50 EUR est passé
de bout en bout sur le compte réel en mode test. Ce qui manque encore côté paiement est le
secret de signature du webhook, et le compte n'est pas activé en mode réel. Voir §6 bis
et §6 sexies.

Une démarche non technique reste au même endroit : la plateforme de facturation
électronique, obligatoire en réception au 1er septembre 2026, c'est-à-dire aujourd'hui
(§6 ter).

La seconde ne bloque rien mais dégrade un chiffre : la constante
`TEESHOOP_WORKER_TOKEN` dans le `wp-config.php` de la boutique (§4 bis). Sans elle, le
moteur de coût ne peut pas demander au Worker le métrage de film réellement occupé par
une commande, et chiffre sur une borne haute qui dépasse la réalité de 0 % à 850 %.

Le gel du déploiement, lui, tient toujours, mais il change de nature : ce n'est plus
un manque d'accès, c'est une méthode. **On travaille en préproduction, on sauvegarde,
puis on déploie.** La boutique a 15 commandes et encaisse.

Le compte admin WordPress n'a jamais manqué en réalité : `LTHAbdou` est administrateur
depuis le 22/07, ce qui est démontré par le fait que la clé API du 14/08 a été créée
sous cet identifiant (`user_id = 30` dans `wp68_woocommerce_api_keys`).

### Depuis le 19 août : ce qu'il faut poser pour qu'une commande fournisseur puisse partir

Rien de ce qui suit ne bloque une séance de développement. Tout bloque **l'envoi réel
d'une commande au fournisseur**, et le refus est explicite à chaque fois : la route
répond 503 ou 401 et l'écran des achats affiche pourquoi.

| À poser | Qui | Où | Sans lui |
|---|---|---|---|
| `FR_CUSTOMER_NR` | **l'associé** (ou son contact fournisseur) | `wrangler secret put FR_CUSTOMER_NR` | La route répond 503 et ne construit aucun document. Voir §5 : nous avons essayé de le deviner, et la sonde dit que c'est indécidable |
| ~~`FR_ORDER_TOKEN`~~ | **posé le 01/09**, tiré au sort et vérifié dans `wrangler secret list` | fait | (c'était le second secret, celui que l'importateur de catalogue ne porte pas) |
| `TEESHOOP_ORDER_TOKEN` | nous, **la même valeur**, elle est dans `~/.config/teeshoop/worker.env` | `./scripts/wp-secrets.sh` en local, `wp config set TEESHOOP_ORDER_TOKEN <valeur> --type=constant --quiet` sur la boutique | L'écran des achats refuse d'envoyer et le dit. Pas posable depuis cette session : ni docker, ni SSH (§6 sexies) |
| La ligne de cron du stock | déploiement | `0 2,6,10,14,18,22 * * * … wp teeshoop stock rafraichir --discret` | Les relevés vieillissent et la boutique dit « Délai à confirmer », ce qui est correct et non une panne |
| Le textile nu déclaré sur chaque produit personnalisable | un opérateur | fiche produit, sous « Vêtement Teeshoop » | Le panier d'achat refuse **chaque ligne** par son nom. Aujourd'hui aucun produit ne le déclare, donc aucun panier réel n'est chiffrable |

Les deux premiers sont détaillés au §5. Le dernier n'est pas un accès, c'est une saisie,
et c'est la seule des cinq qui doit être faite pour **chaque** produit vendu.

### Et une correction du miroir local, à refaire après un `docker compose down -v`

Le `docker-compose.yml` posait `TEESHOOP_CATALOGUE_TOKEN` par `WORDPRESS_CONFIG_EXTRA`
avec un défaut vide, ce qui définissait une constante **vide** que le `define` écrit à la
main plus bas ne pouvait plus remplacer : le conteneur web tenait un jeton vide pendant
que `wp-cli` tenait le vrai. Tous les tests passaient et l'écran d'administration ne
joignait pas le Worker. La ligne est retirée ; sur un miroir reconstruit, poser les
secrets une fois :

```bash
npm run wp:cli -- config set TEESHOOP_CATALOGUE_TOKEN <valeur> --type=constant
npm run wp:cli -- config set TEESHOOP_WORKER_TOKEN <valeur> --type=constant
npm run wp:cli -- config set TEESHOOP_ORDER_TOKEN <valeur> --type=constant
```

Le fuseau horaire du miroir est UTC et celui de la boutique de production l'est aussi.
Ce n'est pas un problème pour le stock, dont l'horodatage est lu dans le fuseau du
fournisseur explicitement depuis le 19 août, mais c'est à savoir avant de conclure quoi
que ce soit d'une date affichée par WordPress.

---

## 1. SSH o2switch : en place depuis le 14/08/2026

**Connexion établie et vérifiée.** Rien n'est à faire ici, la section qui suit reste
pour mémoire (et pour le jour où la clé sera à refaire).

| | |
|---|---|
| Hôte | `ascaphus.o2switch.net` (109.234.166.12) |
| Utilisateur | `dawe4500` |
| Port | 22 |
| Clé | `~/.ssh/teeshoop_o2switch` (ed25519, dédiée) |
| Alias local | `ssh teeshoop` (défini dans `~/.ssh/config`) |
| Racine du site | `~/public_html` |

Aucun mot de passe n'a circulé, comme prévu : seule la clé publique a été installée.

Ce qui a été constaté à la première connexion (lecture seule, plus un fichier témoin
écrit puis supprimé pour prouver le droit d'écriture) :

- **WP-CLI est bien préinstallé** (`/usr/local/bin/wp`), avec `git`, `rsync`, `mysql`,
  `mysqldump`, `composer`, `zip`. **Pas de `node` ni de `npm`** : le studio se
  construit ici et se téléverse construit, jamais compilé sur le serveur.
- **PHP 8.1.34**, côté CLI comme côté web (`~/.cl.selector/defaults.cfg`). PHP 8.1
  n'est plus maintenu en sécurité depuis décembre 2025 : à faire monter, mais
  **après** avoir monté la préproduction, pas avant.
- **Redis et memcached tournent déjà**, relancés par cron. Le point 4 du §2 est donc
  à moitié fait : les serveurs sont là, il reste à brancher WordPress dessus.
- **HPOS est activé** (`woocommerce_custom_orders_table_enabled = yes`). Le plugin
  `teeshoop-core` doit donc déclarer sa compatibilité HPOS et ne jamais lire une
  commande via `get_post_meta`.
- Boutique en **EUR / FR**, `woocommerce_calc_taxes = no` : **la TVA n'est pas
  activée**. À trancher avant la première vraie vente (voir `QUESTIONS-ASSOCIE.md`).
- Aucun `mu-plugins`, aucun `teeshoop-core` déployé, et **le plugin MCP Adapter du §9
  n'est plus là**. Le sujet est clos.

### Écarts avec ce que le brief supposait

| | Attendu | Réel en production |
|---|---|---|
| WordPress | 7.0.3 | **7.0.4** |
| WooCommerce | 11.0.1 | 11.0.1 depuis le 14/08 à 10 h 46 (10.9.4 avant) |

Le miroir local doit passer en **WordPress 7.0.4**. Pour WooCommerce, il n'y a plus
d'écart : la mise à jour 10.9.4 vers 11.0.1 a été faite depuis l'interface WordPress
le 14/08 à 10 h 46, entre deux de nos relevés. Vérifié après coup : `WC_VERSION`,
l'en-tête du fichier et `woocommerce_db_version` disent tous 11.0.1, `wp wc update`
ne réclame aucune migration, `error_log` ne contient aucune erreur fatale depuis, et
l'accueil, la boutique et le panier répondent tous en 200.

C'est arrivé sans casse, mais c'est exactement ce qu'il ne faut pas refaire : une
montée de version majeure de WooCommerce, sur une boutique qui a 15 commandes
réelles, sans préproduction et sans sauvegarde préalable. **Après cPanel, les mises à
jour se testent en préproduction et se font après un `wp db export`.**

---

## 1 bis. Pour mémoire : comment la clé a été posée

C'est la voie d'accès principale. o2switch est de l'hébergement mutualisé cPanel
avec WP-CLI préinstallé : SSH permet d'installer une extension, écrire du PHP,
toucher la base, faire un dump avant chaque opération risquée. L'API REST de
WordPress ne permet aucune de ces quatre choses.

**Ce qu'il me faut :** l'hôte, l'utilisateur cPanel, et le port (22 en général chez
o2switch, parfois autre chose, à lire sur la fiche du compte).

**Aucun mot de passe ne doit circuler.** J'ai généré une paire de clés dédiée à ce
projet. Voici la clé **publique** (elle est faite pour être partagée) :

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID/XXmPOhi3dyb67sK1mUPM7zQZYf0q797WtIsR0x1ZD teeshoop-deploy-20260812
```

Dans cPanel → **Accès SSH** → *Gérer les clés SSH* → **Importer une clé** : coller
la ligne ci-dessus dans « clé publique », laisser « clé privée » vide, puis
**autoriser** la clé une fois importée (l'import seul ne suffit pas, il y a un
bouton « Autoriser » ensuite).

o2switch filtre aussi par IP : cPanel → **Accès SSH** → autoriser l'adresse IP
depuis laquelle je travaille (5 maximum par compte). Si l'IP change souvent, le
**Terminal web** de cPanel contourne la liste blanche et fait aussi l'affaire.

Une clé séparée par destination, volontairement : celle-ci se révoque sans toucher
à la clé GitHub.

---

## 2. cPanel : demande annulée, SSH suffit

Cette section réclamait un accès à l'interface cPanel pour quatre opérations.
Vérification faite le 14/08 sur le serveur, **les quatre passent par SSH**. La demande
est donc retirée : un identifiant de moins à faire circuler et à révoquer un jour.

| Ce qu'il fallait faire | Par où ça passe réellement |
|---|---|
| 1. Créer la préproduction | faite le 13/08 par le développeur, voir §2 bis |
| 2. Figer la version de PHP | `selectorctl` et `cloudlinux-selector`, tous deux présents |
| 3. Vrai cron serveur | `crontab` accessible en écriture (4 lignes aujourd'hui) |
| 4. Redis pour le cache objet | socket déjà là : `~/.cpanel/redis/redis.sock` |

Redis et memcached **tournent déjà**, relancés par le cron du compte. Il manque
seulement le fichier `object-cache.php` dans `wp-content` pour que WordPress s'en
serve : c'est du travail, pas un accès.

Plus large : la commande **`uapi` est disponible en SSH**, donc toute l'API cPanel du
compte l'est aussi. Vérifié en lecture (`DomainInfo list_domains`, `DNS parse_zone`).
C'est ce qui permettra de créer `studio.teeshoop.com` le moment venu, sans interface :

```
uapi SubDomain addsubdomain domain=studio rootdomain=teeshoop.com dir=...
```

Pour mémoire, l'état DNS constaté : `teeshoop.com` est un **domaine additionnel**, les
serveurs de noms sont `ns1/ns2.o2switch.net`, aucun sous-domaine n'existe, et
`studio.teeshoop.com` ne résout pas encore (NXDOMAIN).

---

## 2 bis. Préproduction WP Tiger : en place et vérifiée le 14/08/2026

| | |
|---|---|
| Adresse | `https://4bde-26076daa9357.wptiger.fr` |
| Chemin | `~/myTiger-Preprod/4bde-26076daa9357.wptiger.fr` |
| Protection | HTTP Basic, identifiant `wptiger` |
| Mot de passe | dans `~/.config/teeshoop/woo.env`, hors dépôt, en 600 |

**La protection a été éprouvée, y compris en la faisant échouer** (c'est la seule façon
de savoir qu'une porte est fermée) :

| Test | Résultat |
|---|---|
| Sans identifiants : `/`, `/wp-admin/`, `/wp-login.php` | 401 |
| Sans identifiants : `/wp-json/wp/v2/posts`, `/wp-json/wc/v3/orders` | 401 |
| Sans identifiants : `/wp-content/uploads/`, `/xmlrpc.php`, `/panier/` | 401 |
| Avec identifiants : `/`, `/boutique/`, `/wp-json/wp/v2/types` | 200 |
| Avec un **mauvais** mot de passe | 401 |

Capacités vérifiées en ligne de commande sur la préproduction : écriture puis
suppression d'une option, `wp db export` (35 Mo produits, relus, supprimés), contrôle
des extensions. Autrement dit : de quoi tester une migration et revenir en arrière.

### L'isolation a été prouvée par l'expérience, pas lue dans un fichier

Une préproduction qui partagerait la base de la production transformerait chaque test
en modification de la vraie boutique. Les deux bases portent le même préfixe de tables
(`wp68_`), ce qui est normal pour un clone et ne prouve rien. Donc, en plus de comparer
les deux `DB_NAME` (différents), une option a été écrite en préproduction puis
recherchée en production : **absente**. L'option a ensuite été supprimée.

### Resynchronisée depuis la production le 14/08/2026

Elle était restée en WooCommerce 10.9.4 pendant que la boutique passait en 11.0.1.
Tester sur une copie plus ancienne que l'original ne prouve rien, donc elle a été
resynchronisée à la main en SSH (WP Tiger n'expose pas de commande, et le faire à la
main laisse une trace vérifiable). La procédure est en §2 ter.

Résultat vérifié : `woo=11.0.1  wp=7.0.4  produits=47  commandes=15` des deux côtés,
aucune migration de base en attente, et la production n'a jamais été qu'**lue**.

### Une réserve, et elle ne se règle pas par un accès

1. **Elle contient les données personnelles de vrais clients.** C'est une copie
   intégrale : 15 commandes, donc des noms, adresses, téléphones et e-mails réels,
   dans un second emplacement, derrière un simple mot de passe HTTP. Au sens du RGPD
   c'est un traitement de plus, et le principe de minimisation s'applique. À terme il
   faut **anonymiser la préproduction** après chaque synchronisation (un script
   `wp db query` qui remplace noms, e-mails, adresses et téléphones par des valeurs
   fictives). Tant que ce n'est pas fait, la préproduction se traite comme la
   production : pas de partage d'accès, pas de capture d'écran de commande.

---

## 2 ter. Resynchroniser la préproduction : la procédure

À refaire avant chaque campagne de tests sérieuse. Elle ne touche la production qu'en
lecture. Compter deux à trois minutes.

**Le garde-fou d'abord.** Le `.htaccess` de la préproduction contient le bloc
`o2s WpTiger` qui porte le mot de passe HTTP. L'écraser avec celui de la production
**ouvrirait au public une copie complète de la boutique, commandes comprises**. Il est
donc exclu de la synchronisation, avec `.htpasswd` et `wp-config.php` (base différente).

```bash
PROD=~/public_html
PRE=~/myTiger-Preprod/4bde-26076daa9357.wptiger.fr
BK=~/teeshoop-resync-backup

# 0. Refuser de continuer si les deux installations partagent une base.
[ "$(cd $PROD && wp eval 'echo DB_NAME;')" = "$(cd $PRE && wp eval 'echo DB_NAME;')" ] \
  && { echo "STOP: base commune"; exit 1; }

# 1. Point de retour.
cd $PRE && wp db export $BK/preprod-before-resync.sql
cp -p .htaccess .htpasswd wp-config.php $BK/

# 2. Fichiers. Le --delete est voulu : sinon les fichiers de l'ancienne version
#    de WooCommerce restent et la copie n'est plus une copie.
rsync -a --delete --exclude '/wp-config.php' --exclude '/.htaccess' \
      --exclude '/.htpasswd' --exclude '/wp-content/cache/' --exclude '/error_log' \
      $PROD/ $PRE/

# 3. Base.
cd $PROD && wp db export $BK/prod-snapshot.sql
cd $PRE  && wp db reset --yes && wp db import $BK/prod-snapshot.sql
wp search-replace "www.teeshoop.com" "4bde-26076daa9357.wptiger.fr" --all-tables-with-prefix

# 4. Remettre ce qui distingue une préproduction d'une boutique. La base vient
#    d'être écrasée par celle de la production : ces réglages sont donc à reposer
#    à chaque fois, sinon la copie se comporte comme la vraie boutique.
wp option update blog_public 0
wp config set WP_ENVIRONMENT_TYPE staging
# le coupe-circuit e-mail est un mu-plugin, voir plus bas
```

**Toujours vérifier après, et notamment que la porte est encore fermée** (sans
identifiants : 401 ; avec : 200 ; avec un mauvais mot de passe : 401).

### Le coupe-circuit e-mail

`wp-content/mu-plugins/000-teeshoop-staging-guard.php` intercepte `pre_wp_mail` et
marque l'admin d'un bandeau « PREPRODUCTION ». Sans lui, changer le statut d'une
commande sur la copie enverrait un vrai message à un vrai client, depuis une machine
que personne ne surveille. C'est un mu-plugin et pas un réglage parce qu'un réglage se
remet à « oui » tout seul le jour où on réimporte la base.

Vérifié autrement qu'en regardant `wp_mail()` renvoyer `true`, ce que fait aussi un
envoi réussi : le filtre est bien enregistré et **PHPMailer n'est jamais atteint**, là
où il l'est en production. C'est un mu-plugin, donc `rsync --delete` ne l'efface pas
(la production n'a pas de dossier `mu-plugins`), mais **`wp db reset` n'y touche pas
non plus** : il survit à la resynchronisation. À revérifier quand même.

### Corrigé le 14/08

`blog_public` valait **1** : la préproduction s'annonçait indexable. Le mot de passe
HTTP la protège aujourd'hui (les robots reçoivent 401), mais le jour où quelqu'un le
retire, une copie complète de la boutique devient indexable, avec le contenu dupliqué
et les commandes derrière. Passé à **0**, vérifié dans le HTML réellement servi :

```html
<meta name="robots" content="nofollow, noindex"/>
```

### Ce qui reste imparfait, et qu'on assume

Sept références à `www.teeshoop.com` subsistent dans la copie : un lien codé en dur
dans le pied de page du thème, des entrées de journal Elementor, et des lignes d'un
panier abandonné. `wp search-replace` refuse de les réécrire parce qu'elles sont
sérialisées avec une classe (`THWEPOF_Section`) appartenant à une extension
désinstallée, donc impossible à charger. Les réécrire de force en expression
régulière abîmerait la sérialisation pour un lien de pied de page : le jeu n'en vaut
pas la chandelle. À savoir simplement quand on teste : **un lien du pied de page
renvoie vers la vraie boutique**.

---

## 3. Compte administrateur WordPress dédié : déjà en place

`LTHAbdou` (ID 30), rôle Administrateur, inscrit le 22/07/2026. Rien à créer.

Le second administrateur est `adminder` (ID 1), le compte de l'associé. Deux comptes
nominatifs, c'est exactement la bonne configuration : l'historique reste lisible et
chaque accès se révoque seul.

---

## 4. Clés API WooCommerce : posées et vérifiées le 14/08/2026

Clé `teeshoop-claude` (`key_id` 3), créée sous `LTHAbdou`, permissions
**lecture/écriture**. Stockée hors du dépôt, en `~/.config/teeshoop/woo.env`
(permissions 600) : aucun secret ne peut donc partir dans un commit.

**Ce qui a été testé le 14/08**, contre la vraie boutique :

| Test | Résultat |
|---|---|
| Authentification (`GET wc/v3/system_status`) | 200 |
| Lecture produits / commandes / clients / codes promo | 200 (47 / 15 / 1 / 3) |
| Lecture réglages, catégories, zones de livraison, TVA, paiements | 200 |
| Écriture : création d'un produit en brouillon | 201 |
| Relecture du produit créé | 200, brouillon, masqué du catalogue |
| Suppression définitive puis contrôle | 200 puis 404 |
| Décompte des produits après le test | 47, comme avant |

Le produit de test était en **brouillon et masqué du catalogue** : aucun client n'a
pu le voir. Il a été supprimé définitivement, et son absence vérifiée côté serveur
(`wp post get 3621` renvoie une erreur, 0 reliquat, 47 produits).

### Deux clés dormantes à révoquer

La même table en contient deux autres, toutes deux en **lecture/écriture**, donc
capables de lire les commandes et les données personnelles des clients :

| Description | Dernier usage |
|---|---|
| `SendCloud API` | 14/05/2025 |
| `DSers - API` | 25/01/2025 |

Plus d'un an sans usage. Si ces deux services ne servent plus, les clés sont à
supprimer : WooCommerce → Réglages → Avancé → API REST. Une clé inutilisée n'est pas
inoffensive, c'est une porte que personne ne surveille.

### La clé du 14/08 est à refaire

Elle a transité par une conversation. Ce n'est pas une question de confiance : tout
ce qui est écrit dans une conversation est transmis à un serveur et conservé dans des
journaux, et l'effacer ensuite ne l'en retire pas. Une clé lecture/écriture donne
accès aux 15 commandes, donc aux noms, adresses et adresses e-mail des clients : la
révoquer relève du RGPD autant que de la prudence.

La manœuvre est indolore et prend une minute : créer une nouvelle clé, me donner la
nouvelle par lien autodestructeur (§8), supprimer l'ancienne. À faire quand le
développeur en aura le temps, avant la mise en ligne dans tous les cas.

### `ADMIN_TOKEN` est à faire tourner (14/08/2026, séance 03)

Pendant la mise en place de l'import du catalogue, `wp config set` a **affiché la
valeur qu'il venait d'écrire** dans son message de succès, et cette valeur est donc
passée dans la conversation. Il s'agit du `ADMIN_TOKEN` du `.dev.vars` local, pas
d'un secret de production, **mais** :

- si la même valeur a été posée en production (`wrangler secret put ADMIN_TOKEN`),
  elle ouvre `/api/fr/*`, c'est-à-dire nos prix d'achat sur tout le catalogue et
  notre stock fournisseur ;
- la faire tourner coûte deux commandes.

```bash
openssl rand -base64 32                        # la nouvelle valeur
wrangler secret put ADMIN_TOKEN                # production
#   puis la même valeur dans .dev.vars, et
#   wp config set TEESHOOP_CATALOGUE_TOKEN … --quiet   sur la boutique
```

`scripts/wp-catalogue-verify.mjs` écrit désormais la constante en jetant la sortie de
la commande, précisément pour que cela ne se reproduise pas.

### `TEESHOOP_CATALOGUE_TOKEN` : à poser sur la boutique

L'import du catalogue appelle notre propre Worker et s'authentifie avec le même
secret. Il se déclare dans `wp-config.php`, **jamais dans une option** : les options
partent dans toutes les sauvegardes, dans toutes les migrations, et s'éditent depuis
l'administration.

```php
define( 'TEESHOOP_CATALOGUE_TOKEN', '…la valeur de ADMIN_TOKEN…' );
```

Absent, l'import refuse de tourner et dit lequel des deux réglages manque. Il ne se
rabat jamais sur « importer sans les tarifs » : un catalogue écrit avec tous les prix
d'achat vides ressemble exactement à un import réussi jusqu'au jour du réassort.

## 4 bis. `TEESHOOP_WORKER_TOKEN` : à poser aussi, depuis la séance 05

Le moteur de coût demande au Worker combien de mètres linéaires de film une commande
occupe réellement, en imbriquant ses visuels (`POST /api/nest`). C'est une route
d'administration, protégée par le même `ADMIN_TOKEN`, et la boutique s'y authentifie
avec cette constante. Comme la précédente, elle se déclare dans `wp-config.php` et
**jamais dans une option**.

```bash
wp config set TEESHOOP_WORKER_TOKEN '…la valeur de ADMIN_TOKEN…' --type=constant --quiet
```

`--quiet` n'est pas décoratif : sans lui, `wp config set` réaffiche la valeur qu'il
vient d'écrire, ce qui est exactement l'incident du 14 août décrit deux sections plus
haut.

Absente, rien ne casse et rien ne ment : chaque commande est chiffrée sur une **borne
haute** (une bande de film par transfert, sans imbrication), le rapport de marge le dit
en toutes lettres, et le coût annoncé est plus élevé que la réalité. C'est le sens sûr,
parce qu'un coût majoré remonte le prix plancher au lieu de l'abaisser. Sur les
commandes d'essai, la borne dépasse l'imbrication réelle de 0 % à 850 % selon la forme
des visuels : utilisable pour ne pas vendre à perte, inutilisable pour chiffrer un devis.

---

## 5. Une information, pas un accès : Falk & Ross

Deux questions, dont la réponse change ce qu'il faut faire ensuite :

- **Le compte est-il en mode test ou en mode live ?**
- **`FR_CUSTOMER_NR` était-il défini sur le Worker en production avant le 12 août ?**

Pourquoi ça compte : jusqu'au 12 août, `POST /api/fr/order` passait une commande
fournisseur **sans aucune authentification**. Si `FR_CUSTOMER_NR` n'était pas
défini, aucune commande n'a pu partir et l'affaire est close. S'il l'était, il faut
relire l'historique des commandes du compte Falk & Ross.

Vérification, 5 secondes :

```bash
npx wrangler secret list
```

S'il n'y a que `ADMIN_TOKEN`, `FR_WS_USER`, `FR_WS_PASS` : rien n'a pu partir.
*(vérifié le 12/08, c'est bien le cas, il n'y a pas de `FR_CUSTOMER_NR`)*

### Répondu à moitié le 19/08/2026, par le fournisseur lui-même

**Le compte est en mode test.** Relevé en direct sur le compte réel :
`webservice_mode_code = 1`. Ce n'est pas une réponse de l'associé, c'est une
mesure, et elle peut changer chez le fournisseur sans que nous le décidions.
C'est pourquoi la séance 08 relit le mode **à chaque envoi** et refuse la
commande si le mot que l'opérateur a confirmé à l'écran ne correspond plus.

`scripts/fr-verify.mjs` l'affiche à chaque exécution, et signale en jaune le
passage en mode réel.

### Ce qu'il reste : le numéro de client, et il faut le demander

`FR_CUSTOMER_NR` est toujours absent, et depuis la séance 08 c'est le dernier
verrou : la route d'envoi répond 503 et ne construit aucun document sans lui.

Le code le **devinait** auparavant. Le login du webservice a la forme
`{compte}-{n}-{jeton}`, et il en prenait les premiers chiffres en signalant
qu'il l'avait fait. Un numéro deviné qui décide quel compte est facturé est
exactement ce que ce projet s'interdit : le repli est supprimé.

Nous avons essayé de confirmer la devinette auprès du fournisseur, en mode test,
avec un document dont la seule ligne nomme un article qui n'existe pas.
**Non concluant** : la passerelle répond exactement la même chose à un numéro de
client délibérément faux qu'au nôtre (`orders_id 0`, erreur 10, « Artno not
found »), parce qu'elle refuse sur l'article avant de juger le compte. Le
contrôle 9 de `scripts/fr-verify.mjs` le refait à chaque exécution et dit
« inconclusive » plutôt que de valider la devinette.

**Ce qu'il faut donc demander à l'associé, ou à son contact chez le
fournisseur :** le numéro de client tel qu'il figure sur une facture. Puis, une
seule commande, qui demande la valeur sur son entrée standard et n'écrit rien
dans le dépôt :

```bash
wrangler secret put FR_CUSTOMER_NR
```

Ne la collez nulle part ailleurs : ni dans un message, ni dans un fichier
versionné. En local, elle va dans `.dev.vars`, qui est ignoré par git.

### Et un second secret, à créer nous-mêmes : `FR_ORDER_TOKEN`

Ce n'est pas un accès à demander, c'est une valeur à tirer au sort et à poser,
des deux côtés. `ADMIN_TOKEN` ouvre toutes les routes du Worker, et l'un de ses
porteurs est la tâche de nuit qui importe le catalogue : le jeton en lecture
seule qui vit dans un WordPress sur hébergement mutualisé était aussi celui qui
pouvait passer une commande d'achat. La route d'envoi demande donc un second
jeton, sur un en-tête à elle, que l'importateur ne porte jamais.

```bash
openssl rand -base64 32                 # la valeur, une fois
wrangler secret put FR_ORDER_TOKEN      # côté Worker
npm run wp:cli -- config set TEESHOOP_ORDER_TOKEN <valeur> --type=constant
```

Sur la boutique de production, la même constante va dans `wp-config.php`, à la
main, comme `TEESHOOP_CATALOGUE_TOKEN` et `TEESHOOP_WORKER_TOKEN`. Sans elle
l'écran des achats refuse d'envoyer et le dit.

---

## 6. GitHub

Fait le 12/08 : dépôt renommé `teeshoop`, privé, distant à jour.

Reste à faire quand on montera le déploiement automatique :

- **Ajouter l'associé** en lecture (Settings → Collaborators).
- **Clé de déploiement** pour les GitHub Actions : je générerai une seconde paire
  dédiée, la partie privée ira dans *Settings → Secrets → Actions* (`O2SWITCH_SSH_KEY`),
  la partie publique dans `~/.ssh/authorized_keys` du compte o2switch. Cette clé-là
  ne sert qu'à `rsync` et ne donne pas de shell interactif.

---

## 6 bis. Stripe : les clés de test, maintenant

*(Ajouté le 18 août 2026, séance 04. Le paiement est construit.)*

L'extension officielle Stripe est branchée. Le code n'a besoin de rien d'autre que des
clés, et il refuse d'encaisser tant qu'il n'en a pas.

**Ce qu'il me faut, dans l'ordre.**

| Quoi | Où le prendre | Quand |
|---|---|---|
| `pk_test_…` et `sk_test_…` | Stripe, tableau de bord, mode test, Développeurs puis Clés API | **maintenant**, pour le miroir local |
| Secret de signature du webhook de test | Stripe, Développeurs puis Webhooks | avec les clés de test |
| `pk_live_…` et `sk_live_…` | les mêmes écrans, mode réel | à la mise en ligne, séance 14 |
| Secret de signature du webhook réel | idem | à la mise en ligne |

**Jamais dans une conversation, jamais dans un fichier du dépôt.** Les clés se collent
dans l'écran de réglages de l'extension, sur le site, ou se posent en variable
d'environnement. Si vous me les envoyez par message, il faut les révoquer et en refaire.

**Une vérification qui ne se voit pas dans WordPress.** Les Cartes Bancaires (CB) sont un
réseau à l'intérieur du moyen de paiement « carte », et elles s'activent **dans le tableau
de bord Stripe**, pas dans WordPress. La plupart des cartes françaises sont co-badgées
CB/Visa ou CB/Mastercard et le routage CB coûte moins cher. Rien sur le site ne dira si
c'est désactivé. À contrôler une fois, avant la mise en ligne.

**Le pays du compte Stripe** décide quels moyens de paiement sont disponibles. Confirmez
qu'il est bien ouvert en France.

**Un piège mesuré, pour mémoire.** Le 18 août 2026, sur une extension Stripe fraîchement
activée et jamais enregistrée, l'écran de réglages affichait « mode test » coché pendant
que l'API interne de l'extension répondait « mode réel ». Deux lectures du même réglage
qui se contredisent. Notre alarme ne lit donc pas la case : elle lit le **préfixe de la
clé**, qui ne peut pas se contredire lui-même. Un `sk_test_` est un compte de test, quoi
que dise la case.

---

## 6 ter. Une démarche qui n'est pas un accès : la plateforme de facturation électronique

*(Ajouté le 18 août 2026. Ce n'est pas à moi de la faire.)*

**Au 1er septembre 2026, toute entreprise doit pouvoir RECEVOIR une facture électronique**
par une plateforme agréée. L'obligation d'en émettre ne concerne les TPE et PME qu'au
1er septembre 2027. La réforme n'a pas été repoussée, et l'offre publique gratuite a été
abandonnée : il faut choisir un prestataire.

Le détail et ce que cela change pour le site sont au constat 7 de
[QUESTIONS-ASSOCIE.md](QUESTIONS-ASSOCIE.md). Ce qu'il faut retenir ici : **c'est une
démarche à engager chez le comptable ou la banque, et l'échéance est dans deux semaines.**

---

## 6 quater. Trois informations juridiques, et aucune n'est un accès (séance 12)

Ce ne sont pas des mots de passe. Ce sont trois faits qu'il faut aller LIRE quelque
part, et que la séance 12 a délibérément laissés vides plutôt que de les
reconstituer, parce qu'une information plausible sur une page de mentions légales
est une information qui part en production.

| Quoi | Où le trouver | Qui |
|---|---|---|
| L'identité légale de l'hébergeur : raison sociale, adresse postale, téléphone | Le contrat o2switch, ou les mentions légales publiées par o2switch sur son propre site | Le développeur, en cinq minutes |
| L'avenant de traitement des données (RGPD article 28) de Cloudflare, Stripe et o2switch | L'espace client de chacun. Chez les trois, c'est une case à cocher ou un document à télécharger | Le développeur, un après-midi |
| Le compte Brevo, et son avenant de traitement | Le compte n'existe pas encore (§7 le classe en R4). Il faudra le créer AVANT la mise en ligne, parce que Brevo reçoit le corps des messages, ce qui inclut le lien de validation d'un bon à tirer | À arbitrer |

**Pourquoi l'hébergeur est ici et pas dans `QUESTIONS-ASSOCIE.md`.** Le nom et
l'adresse de l'hébergeur sont imposés par l'article 6 III de la loi pour la
confiance dans l'économie numérique, ils sont publics, et ils ne dépendent
d'aucune décision de l'associé. Ce dépôt connaît le SERVEUR
(`ascaphus.o2switch.net`, 109.234.166.12, compte `dawe4500`) et un nom de serveur
n'est ni une raison sociale ni une adresse postale. Le champ est vide dans
WooCommerce > Facturation, la page `/mentions-legales/` affiche « non communiqué »
en face, et cela restera ainsi jusqu'à ce que quelqu'un ouvre le contrat.

**Ce qui manque et qui n'est PAS ici**, parce que ce sont des décisions et non des
lectures : le directeur de la publication et les coordonnées de contact
(question 56), le médiateur de la consommation (question 57), l'avocat qui relit
les textes (question 58), et qui signe les avenants (question 59).

---

## 6 quinquies. Ce que la séance 13 laisse à poser, et rien n'est bloquant (28/08/2026)

Aucune de ces lignes n'empêche une séance de développement. Toutes empêchent
quelque chose de fonctionner **en production**, et chacune dit quoi.

| À poser | Qui | Où | Sans lui |
|---|---|---|---|
| Une adresse de destination pour la veille | l'associé répond **où** (question 61), le développeur pose la ligne | la ligne de cron `~/veille.sh --dest=…` sur o2switch | La surveillance tourne et n'envoie rien. Elle refuse de démarrer sans destinataire plutôt que d'écrire dans le vide, donc ce n'est pas silencieux : c'est arrêté |
| Les alertes Cloudflare sur le Worker | le développeur | tableau de bord Cloudflare, Workers > Observability | Une erreur du Worker n'est visible que dans `wrangler tail`, en direct, et personne ne regarde en direct. C'est un réglage de tableau de bord, pas du code, et il n'a pas été fait |
| `SHOP_ORIGINS` dans `wrangler.jsonc` | le développeur, au déploiement | `wrangler.jsonc`, puis `wrangler deploy` | Le studio est servi **sans directive `frame-ancestors`**, donc n'importe quel site peut l'encadrer. Un avertissement le dit dans `wrangler tail` à chaque requête, ce qui est la bonne façon de ne pas oublier |
| `TEESHOOP_CSP_ENFORCE` sur la boutique | le développeur, **après** un vrai paiement | `wp config set TEESHOOP_CSP_ENFORCE true` | La politique de sécurité du contenu est envoyée en Report-Only : elle rapporte et ne refuse rien. Ne pas l'appliquer avant qu'une carte soit passée de bout en bout et un défi 3-D Secure franchi : trois des quatre hôtes Stripe qu'elle autorise ne sont prouvés par rien (question 15) |
| PHP 8.1.34 en fin de vie | le développeur | `selectorctl --set-user-current=…` en SSH, **préproduction d'abord** | La production tourne sur une version qui ne reçoit plus de correctif de sécurité. C'est un point de sécurité autant que de performance, et il se teste sur la préproduction parce que le thème Woodmart et Elementor y sont, pas chez nous |
| Le `.htaccess` de l'extension doit arriver sur le serveur | le développeur, au déploiement | `wp-plugins/teeshoop-core/.htaccess` | Sans lui, `README.md` (63 ko de documentation interne) et `data/garments.json` répondent 200 à qui les demande. Vérifié sur le miroir (Apache 2.4) ; **à revérifier sur o2switch** (LiteSpeed), parce qu'un `.htaccess` non honoré ne se voit pas |

### Et une décision, qui n'est pas un accès : R2

Les créations des clients vivent chez Cloudflare et **R2 n'a pas d'instantané**.
La sauvegarde nocturne ne les couvre pas. Une commande payée dont l'artwork a
disparu est une commande que l'atelier ne peut pas imprimer, et il faudrait
redemander son fichier au client, ce qui est le message qu'on ne veut pas écrire.

Deux chemins, et le second est recommandé faute de mesure du volume réel :

1. **Un second seau R2 avec réplication.** Propre, et cela coûte du stockage tous
   les mois chez Cloudflare.
2. **Une copie périodique vers le disque o2switch**, dans la sauvegarde nocturne
   qui existe déjà. Le compte a **323 Go libres** et la sauvegarde actuelle en
   occupe environ 2 sur sept jours (mesuré le 28/08/2026), donc la place est là.
   Le coût est côté R2 : la sortie de données n'est pas facturée, les opérations
   de lecture le sont. Aucun des deux n'a été chiffré ici et il ne faut pas le
   deviner : le volume réel se lit d'abord.

Ce qui manque pour trancher, et personne ne l'a mesuré : le volume réellement
stocké dans R2 aujourd'hui. C'est une commande (`wrangler r2 bucket info`) et
elle appartient à la séance 14, qui a le déploiement sous les yeux.

---

## 6 sexies. Le 1er septembre 2026 : ce qui a été posé, ce qui a été mesuré, ce qui manque

Les réponses de l'associé sont arrivées (les 61, voir `QUESTIONS-ASSOCIE.md`) et les clés
Stripe de test avec elles. Cette section dit ce qui a réellement été fait, avec la mesure
à côté, parce qu'une clé « posée » qu'on n'a pas essayée n'est pas une clé posée.

### Stripe : posé, et essayé

Les clés de **test** vivent dans `~/.config/teeshoop/stripe.env`, en 0600, hors du dépôt,
avec `~/.config/teeshoop/woo.env`. Rien de tout cela ne peut être commité par accident.

Ce qui a été mesuré le 01/09/2026, contre l'API Stripe, avec la clé secrète de test :

| Relevé | Valeur |
|---|---|
| Compte | `acct_1UAr5mRBpUHFK0uT`, standard, « teeshoop test » |
| Pays | **FR**, devise par défaut **eur** |
| `details_submitted` | `true` |
| `charges_enabled` / `payouts_enabled` | **`false` / `false`** |
| `card_payments` | **inactive** |
| `cartes_bancaires_payments` | **inactive** |
| Moyens activés sur la configuration « Default » | `apple_pay`, `bancontact`, `card`, `klarna` |
| Paiement de test de bout en bout | **14,50 EUR, `succeeded`**, carte de test Visa |

Trois conséquences, et aucune n'est un détail.

**Le mode test marche, le mode réel n'est pas ouvert.** Un compte standard encaisse en test
même quand il n'est pas activé, ce que le paiement réussi ci-dessus démontre. Mais
`charges_enabled` à `false` veut dire qu'aucune carte réelle ne passerait aujourd'hui.
L'activation du compte est une démarche chez Stripe, pas une clé, et elle appartient à la
séance 14.

**Les Cartes Bancaires sont inactives.** Le §6 bis annonçait ce contrôle comme « à faire une
fois avant la mise en ligne » ; il est fait, et la réponse est non. La plupart des cartes
françaises sont co-badgées CB, et le routage CB coûte moins cher que Visa ou Mastercard.
C'est une case du tableau de bord Stripe, et c'est de l'argent à chaque commande.

**Deux moyens de paiement demandés par la question 15 ne sont pas activés :** Google Pay
n'apparaît pas dans la configuration, et le virement SEPA non plus. Le mandat administratif
n'est pas un moyen Stripe et se traite hors ligne. Bancontact, lui, est activé et n'a été
demandé par personne : c'est belge, et la question 35 limite la livraison à la France
métropolitaine.

Ce qui manque encore :

| Quoi | Où le prendre | Sans lui |
|---|---|---|
| `STRIPE_TEST_WEBHOOK_SECRET` (`whsec_…`) | Stripe, Développeurs puis Webhooks, mode test | Une commande payée dont la redirection de retour est perdue peut ne jamais passer en « payée », et rien ne le signale |
| `pk_live_…`, `sk_live_…`, secret du webhook réel | les mêmes écrans, mode réel | Séance 14. **Jamais par message** |
| L'activation du compte (`charges_enabled`) | Stripe, onboarding du compte | Aucune carte réelle ne passe |
| Cartes Bancaires | tableau de bord Stripe, moyens de paiement | On paie le réseau le plus cher sur chaque carte française |

**Une réserve sur la façon dont elles sont arrivées.** Le §6 bis dit, et il a raison, que
des clés envoyées par message sont à révoquer. Ce sont des clés de **test** : aucun compte
bancaire n'est exposé et aucune somme réelle n'est atteignable avec elles. La règle reste
la bonne, et la clé secrète de test se fait tourner en un clic (Stripe, Développeurs, Clés
API, « Roll key »). Pour les clés **réelles**, la règle n'admet aucune exception.

### `FR_ORDER_TOKEN` : posé des deux côtés que nous contrôlons

Tiré au sort le 01/09/2026 (`openssl rand -base64 32`), et posé :

- sur le **Worker de production** : `wrangler secret put FR_ORDER_TOKEN`, vérifié dans
  `wrangler secret list`, qui montre maintenant `ADMIN_TOKEN`, `FR_ORDER_TOKEN`,
  `FR_WS_PASS`, `FR_WS_USER` ;
- dans `.dev.vars`, pour `wrangler dev`, fichier ignoré par git ;
- dans `~/.config/teeshoop/worker.env`, en 0600, parce qu'un secret qui n'existe qu'à un
  seul endroit est un secret qu'on repose à zéro le jour où ce endroit disparaît.

Il reste à poser sur la **boutique**, sous le nom `TEESHOOP_ORDER_TOKEN`, et ce n'est pas
faisable depuis cette session (voir « deux empêchements » plus bas).

Ce que la route répond aujourd'hui, mesuré contre le Worker de production
(`https://tshop.abdellah-latreche04.workers.dev`, qui n'était écrit nulle part et l'est
maintenant) :

| Appel | Réponse |
|---|---|
| `POST /api/fr/order`, sans rien | 401 |
| avec un `Bearer` qui n'est pas le bon | 401 `admin_auth` |
| `GET /` | 200, le Worker sert |

**Le `ADMIN_TOKEN` de production n'est pas entre nos mains.** Celui de `.dev.vars` est
refusé par le Worker déployé, ce qui est la rotation du §4 faisant son travail. Conséquence
concrète et à ne pas découvrir en séance 14 : nous ne pouvons ni vérifier la route d'achat
de bout en bout, ni poser `TEESHOOP_CATALOGUE_TOKEN` et `TEESHOOP_WORKER_TOKEN` sur la
boutique, puisque les deux doivent porter cette valeur. Elle se relit dans le tableau de
bord Cloudflare ou se refait avec `wrangler secret put ADMIN_TOKEN`, et si on la refait il
faut la reposer sur la boutique dans le même geste.

### Trois adresses écrites sur le mauvais domaine, corrigées

Mesuré le 01/09/2026. Les questions 56 et 61 donnent `legales@teeshoop.fr`,
`ticket@teeshoop.fr` et `dev@teeshoop.fr`. **`teeshoop.fr` n'existe pas** : NXDOMAIN sur A,
MX et NS, et le registre du `.fr` (AFNIC, RDAP) ne connaît pas le nom. C'est une coquille
du document, confirmée le même jour par le développeur : le domaine détenu est
**`teeshoop.com`** (A `109.234.166.12`, MX `mail.teeshoop.com`, NS o2switch).

Les trois adresses sont donc `legales@teeshoop.com`, `ticket@teeshoop.com` et
`dev@teeshoop.com`.

**Ce qui reste, et ce n'est pas une demande à l'associé :** vérifier que les trois boîtes
existent et sont relevées. Une adresse valable qui ne mène nulle part se comporte
exactement comme une bonne adresse jusqu'au jour où on compte dessus, et les deux endroits
où on compte dessus sont la page de mentions légales (article 6 III de la LCEN) et la
veille, qui refuse de démarrer sans destinataire mais ne peut pas deviner qu'un
destinataire est mort. Cela se lit en SSH :

```bash
uapi Email list_pops    # les boîtes réellement créées sur le compte
```

Le port 22 ne passant pas depuis cette session, c'est la séance 14 qui le fait, avant de
poser la ligne de cron `~/veille.sh --dest=…`.

### Un nouvel accès, que les réponses créent : Imbretex

Quatre réponses (questions 3, 9, 43 et 46) nomment **Imbretex** comme fournisseur
prioritaire, comme référence pour lire le stock, et comme source du délai de 24 heures.
Nous n'avons aucun accès Imbretex : ni compte, ni identifiants de webservice, ni grille.
Tout ce qui est construit lit Falk & Ross.

Ce n'est pas un réglage et ce n'est pas non plus une demande d'accès ordinaire : tant que
la séance 13b n'a pas tranché ce que cette réponse change, demander des identifiants pour
une intégration qui n'existe pas serait prématuré. Ce qui est certain, c'est que la
question 3 dit « les frais de port et seuils de franco doivent être récupérés directement
depuis les comptes fournisseurs », et que sans accès personne ne peut les récupérer.

### `FR_CUSTOMER_NR` : toujours absent, et les réponses ne le donnent pas

La question 22 a été répondue et parle des tarifs négociés et de la validation manuelle.
Elle ne donne pas le numéro de client. Le §5 reste vrai mot pour mot : la route répond 503
et ne construit aucun document, la devinette a été supprimée, et la sonde du fournisseur ne
sait pas distinguer un numéro faux du nôtre. **C'est un numéro à lire sur une facture.**

### Deux empêchements de cette machine, qui ne sont pas des accès manquants

Aucun des deux n'appartient au projet, et les deux se règlent sans demander quoi que ce
soit à personne.

| Empêchement | Diagnostic | Remède |
|---|---|---|
| Le miroir WordPress local ne démarre pas | `docker compose up` échoue sur « failed to create endpoint ». Le noyau qui tourne est `7.1.11-arch1-1` et `/lib/modules/` ne contient que `6.18.48-1-lts` et `7.2.2-arch1-1` : la mise à jour a emporté l'arborescence de modules du noyau courant, donc `veth` ne peut plus se charger et docker n'a plus de réseau conteneur | **Redémarrer** sur `7.2.2-arch1-1` |
| `ssh teeshoop` ne passe pas | « Network is unreachable » puis « Connection timed out ». Ce n'est pas la clé (elle est en place, en 0600, et le `Host teeshoop` est configuré) : le port 22 sortant est bloqué depuis cet environnement, y compris vers `github.com:22`. Le HTTPS, lui, passe (`teeshoop.com` répond 301) | Ouvrir le port 22 sortant, ou faire les gestes o2switch depuis un terminal ordinaire |

Tant que le premier tient, `TEESHOOP_ORDER_TOKEN` et les clés Stripe ne peuvent pas être
posés sur le miroir. `scripts/wp-secrets.sh` existe pour que ce soit une seule commande le
jour où docker remarche, et il refuse proprement en attendant :

```bash
./scripts/wp-secrets.sh            # pose ce qui manque
./scripts/wp-secrets.sh --etat     # n'écrit rien, dit ce qui est posé
```

Il lit ses valeurs dans `~/.config/teeshoop/` et dans `.dev.vars`, jamais dans le dépôt, et
il ne touche jamais la production : `wrangler secret put` reste une commande que l'on tape.

### Un sujet que l'associé ouvre lui-même, et qui n'est pas technique

Son second document se termine par un point sur la **propriété du code** que personne
n'avait posé : le code ne doit pas dépendre durablement du dépôt personnel d'un
développeur, et il faut formaliser avant le lancement commercial la propriété ou les droits
d'utilisation du code, la situation des développements faits en stage ou en alternance, le
dépôt Git principal de l'entreprise et ses administrateurs, la propriété du domaine, de
l'hébergement, des comptes fournisseurs et des clés API, les licences, et ce qui permet à
Teeshoop de continuer à fonctionner si un développeur part.

C'est ici parce que c'est ce document qui tient la liste de ce qui appartient à qui. Deux
faits utiles pour la conversation : le dépôt `LATRECHE-A/teeshoop` est privé et personnel,
et le compte Cloudflare qui porte le Worker, R2 et les secrets est
`abdellah.latreche04@gmail.com`. Le §6 prévoyait déjà d'ajouter l'associé en lecture ; la
demande est maintenant plus large que ça.

---

## 6 septies. Ce que la séance 13b a posé et ce qu'elle a laissé ouvert (01/09/2026)

### L'identité légale est posée sur le miroir, pas en production

Les questions 17, 45 et 56 ont été répondues, et les treize champs sont enregistrés dans
l'option `teeshoop_legal` du **miroir local**. Le portail de mise en ligne
(`npm run verify:lancement`) est passé de neuf refus à zéro sur cette condition, ce qui
prouve que le contrôle fonctionne et ne prouve rien sur la production.

**À refaire en séance 14, sur teeshoop.com**, dans WooCommerce puis Facturation, ou par
WP-CLI :

| Champ | Valeur |
|---|---|
| Raison sociale | PHARAON |
| Forme juridique | SAS, société par actions simplifiée |
| Capital social | 100 EUR |
| Adresse | 97 avenue de Castelnau (**à confirmer**, voir ci-dessous) |
| Code postal, ville | 93700 Drancy |
| SIRET | 93059298500012 |
| Ville du greffe | Bobigny |
| TVA intracommunautaire | FR45930592985 |
| Directeur de la publication | SINGH Simran |
| Adresse de contact | `legales@teeshoop.com` |
| Téléphone | 07 58 48 83 98 |

**L'adresse n'est pas tranchée.** La question 17 donne le siège à Drancy et la question 55
donne le 8 rue Primo Lévi, 93000 Bobigny, pour la fiche Google. C'est le siège qui est
posé, parce qu'il vient d'un SIRET, et la question est reposée à l'associé.

**Ce qui reste vide et n'est pas une question pour lui :** les quatre champs de
l'hébergeur, qui se recopient du contrat o2switch (§6 quater). Le portail les compte
comme des refus tant qu'ils sont vides.

### Les trois boîtes aux lettres, à vérifier et pas à créer

`legales@teeshoop.com`, `ticket@teeshoop.com` et `dev@teeshoop.com`. Le domaine a bien un
serveur de messagerie (`mail.teeshoop.com`), ce qui est vérifié ; que les boîtes existent
et soient **relevées** ne l'est pas. Cela se lit en SSH, en une commande :

```
ssh teeshoop 'uapi Email list_pops'
```

Tant que ce n'est pas fait, la veille ne doit pas être mise en cron : elle refuse déjà de
démarrer sans destinataire, ce qui est correct, mais elle ne peut pas savoir qu'une adresse
syntaxiquement valable ne mène nulle part. Une alerte envoyée dans le vide est exactement
ce que la question 61 voulait éviter.

### Ce que les réponses ajoutent à la liste des choses à obtenir

| À obtenir | De qui | Pourquoi maintenant |
|---|---|---|
| **La facture du fournisseur DTF** | associé | Elle répond seule à quatre inconnues de la question 04 : HT ou TTC (un cinquième de tout le coût de marquage), les frais de livraison (qui décident désormais de **la totalité** des 75,00 EUR que le groupage fait gagner), le minimum de commande et le délai |
| **Un accès Imbretex** | associé | Quatre réponses le nomment fournisseur prioritaire (questions 3, 9, 43, 46) et il n'existe ni compte, ni identifiants, ni grille |
| **La grille Mondial Relay** | associé | Il le nomme transporteur principal et la boutique chiffre toujours sur la grille publique de La Poste |
| **Une phrase du comptable sur la TVA** | associé | La seule ligne que le portail de mise en ligne refuse nommément. Les deux régimes sont construits : ce qui manque est la phrase |
| **Le nom du cabinet juridique et une date** | associé | Le portail refuse une version des conditions générales sans relecteur enregistré |
| **`STRIPE_TEST_WEBHOOK_SECRET`** | associé | Signalé manquant par `Payment::problems()` à chaque exécution de `scripts/wp-secrets.sh` |
| **Cartes Bancaires, Google Pay, virement SEPA** | associé | Mesurés absents ou inactifs de la configuration Stripe le 01/09/2026, alors que la question 15 demande les trois. Le routage CB est nettement moins cher sur une carte française co-badgée : c'est de l'argent à chaque encaissement |

### Un rappel que ce document est le bon endroit pour

L'associé ouvre lui-même, en fin de son second document, la question de la **propriété du
code** : dépôt de l'entreprise, licences, situation des développements de stage, et ce qui
se passe si un développeur part. Le dépôt est aujourd'hui `LATRECHE-A/teeshoop`, un compte
personnel. Ce n'est pas un accès à obtenir, c'est une décision à écrire, et elle est déjà
notée en §6 sexies.

---

## 7. Plus tard : inutile de les créer maintenant

Ces accès ne servent qu'à partir de R1/R2. Les créer trop tôt, c'est multiplier les
identifiants sur une boutique qui ne vend pas encore.

| Service | Quand | Pour quoi |
|---|---|---|
| Brevo | R4 | E-mails transactionnels puis marketing |
| Qonto | R4 | Rapprochement bancaire |
| Ringover | R4 | Téléphonie liée au CRM |
| Un CRM du marché | R4 | **À acheter, pas à construire**, voir le plan |

---

## 8. Comment transmettre tout ça

**Ne collez jamais un mot de passe ou une clé dans une conversation**, avec moi ou
avec qui que ce soit. Tout ce qui y est écrit est transmis et conservé, et le
supprimer ensuite ne le retire pas des journaux.

Par ordre de préférence :

1. **Rien à transmettre**, c'est le cas de SSH : vous installez ma clé publique,
   aucun secret ne circule dans aucun sens. C'est pour ça que SSH passe en premier.
2. **Lien à usage unique et autodestructeur** pour ce qui ne peut pas éviter d'être
   transmis (clés Woo, mot de passe cPanel). Le lien s'ouvre une fois puis meurt.
3. **`wrangler secret put` en local** pour tout secret Cloudflare : la valeur est
   saisie au clavier, envoyée à Cloudflare, et n'est écrite nulle part sur le disque
   ni dans l'historique du shell.

Et : **faites tourner toute clé qui a déjà été partagée en clair**, quel que soit le
canal. Une clé qui a transité par un message est une clé publique.

---

## 9. Ce qu'il ne faut **pas** activer

- **Les mots de passe d'application WordPress.** Ils sont désactivés aujourd'hui
  (`/wp-json/` renvoie `"authentication": []`), très probablement par Wordfence.
  Laissez-les désactivés. Ils n'apportent rien que SSH ne fasse déjà, et ils
  ajoutent un identifiant équivalent à un mot de passe sur une boutique qui va
  encaisser des paiements.
- ~~**Le plugin MCP Adapter**~~ : **réglé**. Constaté le 14/08, il n'est plus installé
  (ni dans `plugins`, ni en `mu-plugins`). Ses dernières traces dans `error_log`
  datent du 12/08. Le sujet est clos, il n'y a pas à le réactiver.
- **Un second compte administrateur partagé.** Un admin nominatif par personne.
- **L'API REST WooCommerce dite « legacy »** (`woocommerce-legacy-rest-api`, active).
  Elle n'est plus maintenue et double une surface d'attaque que `wc/v3` couvre déjà.
  À désactiver, mais **en préproduction d'abord** : SendCloud ou DSers peuvent
  encore s'en servir, et une désactivation à l'aveugle casserait la livraison.

---

## 10. Ce que je peux faire sans rien attendre

Pour situer ce qui est réellement bloqué et ce qui ne l'est pas :

| Travail | Bloqué ? |
|---|---|
| Studio (2D, 3D, AR, DTF, panier) | non |
| Worker Cloudflare, R2, proxy fournisseur | non |
| Tests, CI, garde-fous de bundle | non |
| **Plugin `teeshoop-core` en PHP** | non, développé et testé sur WordPress local |
| Moteur de prix PHP + ses tests | non |
| Pont `postMessage` studio ↔ WooCommerce | non |
| Déployer sur teeshoop.com | non (SSH) |
| Tester en préproduction | non (§2 bis) |
| Supprimer les produits de démo | non (SSH ou clés Woo) |
| Créer les produits de R1 | non (clés Woo, vérifiées en écriture le 14/08) |
| Créer `studio.teeshoop.com` | non (`uapi SubDomain`, voir §2) |
| Figer PHP, poser le cron serveur, brancher Redis | non (SSH, voir §2) |
| Encaisser un paiement de test | non, depuis le 01/09 (clés posées et essayées, §6 sexies) |
| Faire tourner le miroir WordPress local | **oui : docker n'a plus de réseau conteneur** (§6 sexies) |
| Ouvrir une session SSH depuis cette machine | **oui : le port 22 sortant ne passe pas** (§6 sexies) |
| Trancher la TVA, les CGV, les prix | **oui : réponses de l'associé** |

Autrement dit : au 14/08, **aucun travail technique n'est bloqué par un accès**. Ce
qui bloque encore est d'une autre nature : des décisions qui appartiennent à
l'associé, et une méthode que l'on s'impose (préproduction, sauvegarde, puis
déploiement) parce que la boutique encaisse déjà.
