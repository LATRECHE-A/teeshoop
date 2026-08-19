# Accès et secrets — la liste complète

> Objectif de ce document : que je ne sois **jamais bloqué** faute d'un accès.
> Il est ordonné par ce qui bloque le plus tôt. Chaque ligne dit *pourquoi* l'accès
> est nécessaire — si la raison ne tient pas, l'accès ne doit pas être donné.
>
> Dernière mise à jour : 18 août 2026 · voir aussi [QUESTIONS-ASSOCIE.md](QUESTIONS-ASSOCIE.md)

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

**Depuis le 18 août, deux choses manquent à nouveau.** La première bloque une vente :
les clés Stripe de test. Le paiement est construit et il refuse d'encaisser sans elles. Voir §6 bis.
Une démarche non technique s'ajoute au même endroit : la plateforme de facturation
électronique, obligatoire en réception au 1er septembre 2026 (§6 ter).

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
o2switch, parfois autre chose — à lire sur la fiche du compte).

**Aucun mot de passe ne doit circuler.** J'ai généré une paire de clés dédiée à ce
projet. Voici la clé **publique** — elle est faite pour être partagée :

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

## 7. Plus tard — inutile de les créer maintenant

Ces accès ne servent qu'à partir de R1/R2. Les créer trop tôt, c'est multiplier les
identifiants sur une boutique qui ne vend pas encore.

| Service | Quand | Pour quoi |
|---|---|---|
| Brevo | R4 | E-mails transactionnels puis marketing |
| Qonto | R4 | Rapprochement bancaire |
| Ringover | R4 | Téléphonie liée au CRM |
| Un CRM du marché | R4 | **À acheter, pas à construire** — voir le plan |

---

## 8. Comment transmettre tout ça

**Ne collez jamais un mot de passe ou une clé dans une conversation** — avec moi ou
avec qui que ce soit. Tout ce qui y est écrit est transmis et conservé, et le
supprimer ensuite ne le retire pas des journaux.

Par ordre de préférence :

1. **Rien à transmettre** — c'est le cas de SSH : vous installez ma clé publique,
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
  (`/wp-json/` renvoie `"authentication": []`) — très probablement par Wordfence.
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
| **Plugin `teeshoop-core` en PHP** | non — développé et testé sur WordPress local |
| Moteur de prix PHP + ses tests | non |
| Pont `postMessage` studio ↔ WooCommerce | non |
| Déployer sur teeshoop.com | non (SSH) |
| Tester en préproduction | non (§2 bis) |
| Supprimer les produits de démo | non (SSH ou clés Woo) |
| Créer les produits de R1 | non (clés Woo, vérifiées en écriture le 14/08) |
| Créer `studio.teeshoop.com` | non (`uapi SubDomain`, voir §2) |
| Figer PHP, poser le cron serveur, brancher Redis | non (SSH, voir §2) |
| Encaisser un paiement de test | **oui : clés Stripe de test** (R1, §7) |
| Trancher la TVA, les CGV, les prix | **oui : réponses de l'associé** |

Autrement dit : au 14/08, **aucun travail technique n'est bloqué par un accès**. Ce
qui bloque encore est d'une autre nature : des décisions qui appartiennent à
l'associé, et une méthode que l'on s'impose (préproduction, sauvegarde, puis
déploiement) parce que la boutique encaisse déjà.
