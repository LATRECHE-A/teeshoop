# Accès et secrets — la liste complète

> Objectif de ce document : que je ne sois **jamais bloqué** faute d'un accès.
> Il est ordonné par ce qui bloque le plus tôt. Chaque ligne dit *pourquoi* l'accès
> est nécessaire — si la raison ne tient pas, l'accès ne doit pas être donné.
>
> Dernière mise à jour : 14 août 2026 · voir aussi [QUESTIONS-ASSOCIE.md](QUESTIONS-ASSOCIE.md)

---

## État actuel

| Accès | État | Ce qu'il débloque |
|---|---|---|
| Dépôt GitHub `LATRECHE-A/teeshoop` | ✅ en place | Le code, la CI |
| Cloudflare (Worker + R2) | ✅ en place | Le studio, le proxy fournisseur |
| Falk & Ross (API web service) | ✅ en place | Catalogue, stock, prix d'achat |
| `ADMIN_TOKEN` sur le Worker | ✅ posé le 12/08 | La console atelier |
| SSH o2switch | ✅ **posé et vérifié le 14/08** | Tout le travail WordPress |
| **cPanel o2switch** | ❌ **manquant** | La préproduction, le cron, Redis |
| Compte admin WordPress | ✅ confirmé le 14/08 (`LTHAbdou`, ID 30) | Réglages Woo, pages, extensions |
| Clés API WooCommerce | ✅ **posées et vérifiées le 14/08** | Produits, commandes par script |

**Il ne manque plus que cPanel.** Sept lignes sur huit sont en place. Celle qui reste
est aussi celle qui commande la suite : la préproduction ne se crée que là, et tant
qu'elle n'existe pas, **rien ne doit être déployé sur teeshoop.com**. La boutique a
déjà 15 commandes et encaisse.

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

## 2. cPanel : le seul accès qui manque encore

Quatre choses ne se font que là (le point 4 est à moitié réglé : Redis et memcached
tournent déjà sur le compte, relancés par cron ; il reste à y brancher WordPress) :

1. **Créer la préproduction** — *WP Tiger → Préproduction*. On ne développe jamais
   sur la boutique en production, surtout une fois qu'elle encaisse.
2. **Figer la version de PHP** — o2switch prévient que la version par défaut peut
   changer d'elle-même. Une mise à jour de PHP non choisie casse WooCommerce un
   matin sans que personne n'ait rien fait.
3. **Vrai cron serveur** à la place de WP-Cron. WP-Cron ne se déclenche que si
   quelqu'un visite le site : sur une boutique calme, les tâches planifiées
   (synchronisation catalogue, relances) ne partent tout simplement pas.
4. **Redis** pour le cache objet.

Un compte cPanel partagé convient ici, ces opérations sont ponctuelles.

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
*(vérifié le 12/08 — c'est bien le cas, il n'y a pas de `FR_CUSTOMER_NR`)*

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

## 7. Plus tard — inutile de les créer maintenant

Ces accès ne servent qu'à partir de R1/R2. Les créer trop tôt, c'est multiplier les
identifiants sur une boutique qui ne vend pas encore.

| Service | Quand | Pour quoi |
|---|---|---|
| Stripe (ou Revolut Business) | R1 | Encaisser la première commande |
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
| Déployer sur teeshoop.com | techniquement non (SSH est là), **mais pas avant la préproduction** |
| Créer la préproduction | **oui : cPanel** |
| Supprimer les produits de démo | non (SSH ou clés Woo) |
| Créer les produits de R1 | non (clés Woo, vérifiées en écriture le 14/08) |

Autrement dit : depuis le 14/08, plus rien n'est bloqué côté outil. Le seul verrou
qui reste est délibéré : **on ne touche pas une boutique qui a 15 commandes sans
préproduction ni sauvegarde**. C'est cPanel qui débloque ça.
