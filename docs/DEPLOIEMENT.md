# Déployer Teeshoop

> Écrit en séance 14, le 2 septembre 2026. Chaque durée de ce document a été
> chronométrée en faisant la chose, sur la vraie préproduction. Ce qui n'a pas été
> mesuré le dit.

Ce document s'adresse à deux personnes : le développeur, et l'associé le jour où
il devra faire ou défaire quelque chose sans lui. Il est donc écrit pour être
suivi ligne à ligne, sans rien deviner.

---

## En trente secondes

| Je veux | Je fais |
|---|---|
| Livrer en préproduction | Rien. Un `push` sur `main` le fait tout seul. |
| Livrer en production | GitHub, onglet **Actions**, *Déploiement*, **Run workflow**, cible `prod`. Aujourd'hui **ça refuse**, et c'est voulu : voir §6. |
| Annuler la dernière livraison | `ssh teeshoop './deploiement.sh retour preprod'` · **3 secondes** |
| Tout remettre comme avant-hier | §7, la restauration de base · **18 secondes** |
| Savoir où en est une installation | `ssh teeshoop './deploiement.sh etat preprod'` |
| Le site est cassé, il est 19 h vendredi | §8 |

---

## 1. Les trois installations, et ce qui les distingue

| | Miroir local | Préproduction | Production |
|---|---|---|---|
| Où | docker, sur la machine du développeur | `4bde-26076daa9357.wptiger.fr` | `www.teeshoop.com` |
| Chemin serveur | `wp-local/docker-compose.yml` | `~/myTiger-Preprod/4bde-26076daa9357.wptiger.fr` | `~/public_html` |
| Base | `teeshoop` (conteneur) | `dawe4500_wp59838` | `dawe4500_wp820` |
| WordPress | 7.1 | 7.1 | 7.1 |
| WooCommerce | 11.0.1 | 11.0.1 | 11.0.1 |
| PHP | 8.3 | 8.1.34 | 8.1.34 |
| Protection | aucune, local | mot de passe HTTP | publique |
| Envoi d'e-mails | normal | **coupé** (mu-plugin) | réel |
| Données clients | aucune | **anonymisées** (§5) | 15 commandes réelles |

**Les deux installations o2switch sont sur le même compte et ne partagent PAS la
même base**, ce qui a été prouvé en écrivant une option d'un côté et en ne la
trouvant pas de l'autre, puis reprouvé en comparant les deux `DB_NAME`.

### Le piège qui a coûté deux relevés contradictoires

**Les mises à jour majeures automatiques de WordPress sont activées** sur les deux
(`auto_update_core_major = enabled`). La production est passée de 7.0.4 à 7.1
toute seule le 20 août, et la préproduction pendant la séance du 2 septembre, à
14 h 38, entre deux relevés faits à une heure d'intervalle.

Répéter une manoeuvre sur une préproduction qui n'a pas la version de la boutique
ne prouve rien. C'est pour cela que le déploiement commence par
`node scripts/pin-verify.mjs`, qui compare `docs/versions-cibles.json` à ce que la
cible répond vraiment et **refuse si ça a bougé**.

Quand il refuse : rejouer les essais sur la préproduction, puis corriger
`docs/versions-cibles.json` **et** `wp-local/docker-compose.yml` dans un commit qui
dit pourquoi. Jamais contourner le contrôle.

---

## 2. Ce qui part, et ce qui ne part jamais

**Ce qui part :** `wp-plugins/teeshoop-core/` et `wp-themes/teeshoop/`. Rien d'autre.

Les tests et le `README.md` de l'extension sont exclus : rien à l'exécution ne les
lit, et `wp-content/plugins/` est servi par URL.

**Ce qui ne part JAMAIS :**

- `wp-content/uploads` : ni copié, ni supprimé, ni touché ;
- une installation WordPress entière ;
- la base de données ;
- un produit, une commande ou un client.

Ce n'est pas une promesse, c'est une propriété : `scripts/deploiement.sh` n'a
aucun verbe qui puisse le faire, et la clé de déploiement ne peut lancer que ce
script.

**Le studio ne part pas d'ici non plus.** Il est servi par le Worker Cloudflare, et
il n'y a **qu'un seul Worker pour les deux environnements** : le publier depuis un
`push` changerait ce que voient les clients de la production. C'est un travail
manuel, en bas de `.github/workflows/deploiement.yml`, et il le reste tant qu'il
n'y a pas un second environnement Worker.

---

## 3. Comment un déploiement se déroule vraiment

```
push sur main
  └─ CI (les mêmes contrôles que d'habitude, appelés et non recopiés)
       └─ pin-verify        la cible est-elle la version attendue          17 s
       └─ sauvegarder       base + fichiers + manifeste, avant tout        25 s
       └─ rsync             vers un dépôt d'attente, PAS sur le site        1 s
       └─ installer                                                        14 s
            ├─ php -l de chaque fichier, avec le PHP DU SERVEUR
            ├─ l'ancien est mis de côté sous un horodatage
            ├─ le nouveau est renommé à sa place
            ├─ wp plugin activate
            ├─ wp teeshoop migrer
            └─ une sonde charge WordPress et demande sa version à l'extension
```

**Chacune des quatre dernières étapes qui échoue remet la livraison précédente**,
sur le serveur, sans revenir à GitHub.

**Pourquoi un dépôt d'attente et pas un `rsync` direct.** Un `rsync --delete` sur
le répertoire servi laisse, pendant toute la durée du transfert, une extension
dont la moitié des fichiers est d'avant et l'autre d'après. Un client peut arriver
pendant ce temps. Deux `mv` sur le même système de fichiers, c'est deux
renommages.

**Pourquoi le `php -l` du serveur en plus de celui de l'intégration continue.**
L'intégration continue analyse sur `php:8.1-cli`, ce qui couvre la **version**.
Elle ne couvre pas ce binaire-ci, avec ses extensions et son `php.ini`. Un fichier
qui ne s'analyse pas là-bas est une page blanche, et il ne faut surtout pas
l'installer pour s'en apercevoir.

**Mesuré le 02/09/2026 sur la préproduction :** 91 fichiers PHP analysés en
8.1.34, extension activée, schéma 3/3, sonde répondue. Déploiement complet en
**17 secondes** hors sauvegarde.

---

## 4. La clé de déploiement, et ce qu'elle ne peut pas faire

Une paire dédiée (`teeshoop-deploy-actions-20260902`), posée dans
`~/.ssh/authorized_keys` avec :

```
command="/home/dawe4500/deploiement.sh",restrict,no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding ssh-ed25519 AAAA… teeshoop-deploy-actions-20260902
```

`command=` veut dire que la commande demandée par le client est **ignorée** et que
ce script est lancé à sa place. Essayé, avec la vraie clé contre le vrai serveur :

| Ce qu'on demande | Ce qu'on obtient |
|---|---|
| un shell interactif | `verbe inconnu « »` |
| `cat ~/.ssh/id_rsa` | `verbe inconnu « cat »` |
| `etat prod; cat /etc/passwd` | `environnement inconnu « prod; »` |
| `etat /etc` | `environnement inconnu « /etc »` |
| `etat preprod` | l'état de la préproduction |

`rrsync`, l'enveloppe restreinte livrée avec rsync, **n'est pas sur ce serveur**
(rsync 3.1.3 est là, `rrsync` nulle part). L'aiguilleur valide donc lui-même
l'invocation : mode serveur obligatoire, `--sender` refusé, toute option longue
refusée sauf les suppressions et deux qui ne changent que l'affichage, et la
destination comparée à l'identique et non par préfixe.

---

## 5. La préproduction ne doit pas porter de données personnelles

C'est une copie intégrale de la boutique. Au sens du RGPD c'est un traitement de
plus, et le principe de minimisation s'y applique.

**Après chaque resynchronisation :**

```bash
ssh teeshoop './anonymiser-preprod.sh'
```

Il refuse de tourner ailleurs qu'en préproduction, et il y a **quatre verrous
indépendants** parce qu'un seul qui se trompe suffirait : le chemin, le type
d'environnement WordPress, `blog_public`, et la comparaison des deux `DB_NAME`.
Essayé contre la production : refusé au premier verrou.

**Il se vérifie lui-même**, et c'est la moitié qui compte : il relève les
identifiants réels avant de commencer, nettoie, puis **exporte la base entière et
cherche chacun d'eux dedans**. Un vidage relu par un `grep` ne partage aucun code
avec les requêtes de nettoyage, donc il ne peut pas partager leur angle mort.

**Ce que ça a trouvé, et qu'une liste écrite à la main n'aurait pas eu.** Le
premier jet couvrait les quinze clients, leurs adresses, leurs notes de commande
et quatre tables marketing. Il a laissé **47 identifiants sur 48** en place. Il y a
**70 adresses e-mail distinctes** dans cette base et pas quinze, réparties dans
des endroits que personne n'avait inventoriés :

| Où | Quoi |
|---|---|
| `wp68_wflogins` | 108 tentatives de connexion journalisées par Wordfence, avec identifiant et IP |
| `wp68_e_submissions_values` | 27 formulaires remplis par des visiteurs, conservés par Elementor |
| `wp68_wfconfig.alertEmails` | l'adresse qui reçoit les alertes du pare-feu, dans un `longblob` que `wp search-replace` ne touche pas |
| `rank_math_connect_data` | le compte relié au service Rank Math |
| `wp68_postmeta._billing_address_index` | l'adresse postale complète, en clair, hors HPOS |

**Ces tables existent aussi en production**, où personne ne leur a fixé de durée
de conservation. C'est une question ouverte, pas un problème de préproduction.

**Ce que ce script ne fait pas :** rendre la copie anonyme au sens de la CNIL.
Quinze commandes datées restent quinze commandes datées. Il retire les
identifiants directs. Le mot de passe HTTP reste nécessaire.

---

## 6. La production : pourquoi elle refuse aujourd'hui

Le travail de production lance le portail de mise en ligne **avant tout envoi de
fichier**, sans `continue-on-error`. C'est la troisième des trois règles écrites
le 18 août 2026 :

> « La mise en ligne est bloquée automatiquement tant qu'une réponse bloquante
> manque sur un nombre qu'un client, un fournisseur ou une imprimante finit par
> voir. Ce n'est pas une note dans un document, c'est un contrôle qui refuse de
> laisser passer. »

**Il n'y a pas de dérogation et il ne faut pas en écrire une.** La porte se lève
en répondant aux questions qu'elle nomme. `docs/MISE-EN-LIGNE.md` dit lesquelles.

**Une subtilité qui a failli rendre cette porte inutile.** Le portail interroge la
boutique par `--boutique=deploy:teeshoop:prod`, et non par
`--boutique=ssh:teeshoop:~/public_html`. La clé de déploiement est posée avec une
commande forcée : elle ne peut lancer que les verbes de `deploiement.sh`, jamais
`wp-cli`. Écrite sous la seconde forme, la commande recevait « verbe inconnu », le
portail concluait « boutique injoignable » et sortait 2 **quel que soit l'état
réel de la boutique**. Il bloquait donc toujours, pour la mauvaise raison, et il
aurait continué à bloquer le jour où la vraie réponse aurait été « on peut ».
Trouvé par une relecture adverse avant le premier déploiement.

---

## 7. Revenir en arrière

Deux mécanismes, et ils ne servent pas à la même chose.

### 7 a. Annuler la livraison : 3 secondes

```bash
ssh teeshoop './deploiement.sh versions preprod'      # les livraisons gardées
ssh teeshoop './deploiement.sh retour preprod'        # la précédente
ssh teeshoop './deploiement.sh retour preprod 2026-09-02T133209Z'   # une en particulier
```

Ne touche que les fichiers de l'extension et du thème. **Ne touche pas la base.**

**Chronométré le 02/09/2026 sur la préproduction : 2 946 ms**, extension
désactivée et retirée, les trois pages (accueil, boutique, panier) répondant
toujours 200.

Quand il n'y avait rien avant (premier déploiement), le retour **retire**
l'extension et la désactive d'abord, sinon WordPress garde son nom dans
`active_plugins` et se plaint à chaque page.

### 7 b. Remonter la base : 18 secondes

À faire quand une migration ou une manipulation a changé des données.

```bash
cd ~/myTiger-Preprod/4bde-26076daa9357.wptiger.fr
ls ~/sauvegardes-preprod/                     # choisir l'horodatage
D=~/sauvegardes-preprod/2026-09-02T132915Z
( cd $D && grep -E '^[0-9a-f]{64}' MANIFESTE.txt | sha256sum -c - )   # l'archive est-elle intacte
gzip -dc $D/base.sql.gz > /tmp/r.sql
wp db reset --yes && wp db import /tmp/r.sql && rm -f /tmp/r.sql
grep -E '^commandes' $D/MANIFESTE.txt          # ce que la restauration doit retrouver
wp db query 'SELECT COUNT(*) FROM wp68_wc_orders' --skip-column-names
```

**Chronométré le 02/09/2026, en vrai, sur la préproduction :**

| Étape | Durée |
|---|---|
| décompression | 1 079 ms |
| `wp db reset` | 1 950 ms |
| `wp db import` | 14 960 ms |
| **total** | **17 989 ms** |

Vérifié après : 15 commandes (le manifeste en annonçait 15), 47 produits, 159
tables, `siteurl` inchangée. Et **un témoin écrit juste avant avait disparu**, ce
qui est la seule preuve que la restauration a vraiment remonté le temps au lieu de
ne rien faire.

**Quatre choses qu'une restauration ne remet pas, et qu'il faut savoir :**

1. **Le compteur de numérotation des documents recule.** Il vit dans la base
   (`wp68_teeshoop_sequence`). Des numéros déjà émis seraient réémis. Sur une
   boutique qui a envoyé des documents, il faut le remonter à la main après.
2. **Les fichiers du code ne sont pas dedans.** C'est §7 a qui les remet.
3. **Les créations des clients sont chez Cloudflare R2**, qui n'a pas
   d'instantané. La sauvegarde nocturne ne les couvre pas.
4. **Restaurer un vidage de PRODUCTION sur la préproduction** réimporte le
   comportement de la production avec : `blog_public` repasse à 1, l'anonymisation
   est perdue, et il faut refaire §5 et le `search-replace` des URL. Restaurer le
   vidage de la préproduction elle-même, comme ci-dessus, ne pose aucun de ces
   problèmes : mesuré, `blog_public` est resté à 0, le coupe-circuit e-mail et le
   mot de passe HTTP ont survécu (ils sont dans des fichiers, pas dans la base).

---

## 8. Le site est cassé et il est 19 h vendredi

Dans cet ordre, sans réfléchir :

1. **Est-ce qu'un déploiement vient de passer ?**
   `ssh teeshoop 'tail -20 ~/teeshoop-deploiements/journal.log'`
2. **Si oui :** `ssh teeshoop './deploiement.sh retour prod'` · 3 secondes.
   Rafraîchir le site. Si c'est réparé, on s'arrête là et on regarde demain.
3. **Si ce n'est pas ça**, l'état :
   `ssh teeshoop './deploiement.sh etat prod'`
4. **Le journal PHP :** `ssh teeshoop 'tail -50 ~/public_html/error_log'`
5. **La surveillance :** `ssh teeshoop 'tail -30 ~/.teeshoop-veille/journal.log'`
6. **En dernier recours seulement**, la base : §7 b, avec
   `~/sauvegardes/` et non `~/sauvegardes-preprod/`.

**Ne jamais commencer par restaurer la base.** Elle contient les commandes, et
neuf pannes sur dix viennent du code, que §7 a défait en trois secondes sans rien
risquer.

---

## 9. La sauvegarde, et pourquoi elle mérite qu'on la regarde

`sauvegarde.sh` tourne à 3 h 30, garde sept jours, écrit dans `~/sauvegardes/`.
Chaque sauvegarde contient la base, les téléversements, le `wp-config.php` et un
**manifeste qui dit ce qu'une restauration doit retrouver** (le nombre de
commandes) et les empreintes SHA-256 des trois fichiers.

**Elle n'a pas tourné entre le 29 août et le 2 septembre**, cinq nuits, et
personne ne l'a su. La cause : `cron` impose `PATH=/usr/bin:/bin`, où `wp-cli`
(dans `/usr/local/bin`) est introuvable. La surveillance l'a détecté à chaque
passage et n'a jamais pu le dire, parce que sous le même `PATH` `/usr/bin/php` est
**php-cgi**, qui refuse l'option `-r` par laquelle l'alerte partait, et que le
script écrivait « déjà signalé » sans regarder si l'envoi avait marché.

C'est corrigé en trois endroits volontairement redondants : les deux scripts
complètent leur `PATH` eux-mêmes, la ligne de `crontab` porte un `PATH` explicite,
et `veille.sh` n'écrit plus l'état d'alerte quand l'envoi a échoué.

**À vérifier une fois par mois, en dix secondes :**

```bash
ssh teeshoop 'ls -1 ~/sauvegardes/ | tail -3; tail -3 ~/sauvegardes/journal.log'
```

Si la sauvegarde la plus récente a plus de deux jours, quelque chose est cassé.

---

## 10. Les secrets : lequel vit où

**Aucun n'est dans le dépôt, et aucun ne doit y arriver.**

| Secret | Où il vit | Qui le pose | Sans lui |
|---|---|---|---|
| `O2SWITCH_DEPLOY_KEY` | GitHub → Settings → Secrets → Actions | développeur | Aucun déploiement. Le travail s'arrête à la première étape en le disant. |
| `O2SWITCH_HOST` · `O2SWITCH_USER` | idem | développeur | idem |
| `O2SWITCH_KNOWN_HOSTS` | idem | développeur | Le déploiement refuse : on n'accepte pas une clé d'hôte à l'aveugle |
| `CLOUDFLARE_API_TOKEN` | idem | développeur | Le studio ne se publie pas |
| `ADMIN_TOKEN` | `wrangler secret put` (Worker) | développeur | La console atelier et les routes `/api/fr/*` refusent |
| `TEESHOOP_CATALOGUE_TOKEN` | `wp-config.php` de la boutique, **jamais une option** | développeur | L'import du catalogue refuse et dit lequel manque |
| `TEESHOOP_WORKER_TOKEN` | idem | développeur | Le coût est chiffré sur une borne haute, de 0 % à 850 % au-dessus |
| `FR_ORDER_TOKEN` | `wrangler secret put` | posé le 01/09 | La route d'envoi fournisseur répond 401 |
| `TEESHOOP_ORDER_TOKEN` | `wp-config.php`, **la même valeur** | développeur | L'écran des achats refuse d'envoyer et le dit |
| `FR_WS_USER` · `FR_WS_PASS` | `wrangler secret put` | posés | Pas de catalogue fournisseur |
| `FR_CUSTOMER_NR` | `wrangler secret put` | **l'associé** | La route répond 503 et ne construit aucun document |
| Clés Stripe de **test** | écran de réglages WooCommerce, **préproduction seulement** | développeur | Aucun paiement d'essai |
| Clés Stripe **réelles** | écran de réglages WooCommerce, production | à la mise en ligne | Aucune carte réelle ne passe |
| Clés API WooCommerce | `~/.config/teeshoop/woo.env`, hors dépôt, en 600 | développeur | Pas de script contre la boutique |
| Mot de passe HTTP de la préproduction | idem | WP Tiger | Pas d'accès à la préproduction |

**Pourquoi `wp-config.php` et jamais une option WordPress :** les options partent
dans toutes les sauvegardes, dans toutes les migrations, et s'éditent depuis
l'administration.

**Toujours `wp config set … --quiet`.** Sans `--quiet`, `wp config set` réaffiche
la valeur qu'il vient d'écrire, ce qui est exactement l'incident du 14 août.

---

## 11. Poser les secrets GitHub, une fois

```bash
# La partie publique est déjà dans ~/.ssh/authorized_keys du compte o2switch.
gh secret set O2SWITCH_DEPLOY_KEY  < ~/.config/teeshoop/deploy_o2switch
gh secret set O2SWITCH_HOST        --body 'ascaphus.o2switch.net'
gh secret set O2SWITCH_USER        --body 'dawe4500'
ssh-keyscan -t ed25519 ascaphus.o2switch.net | gh secret set O2SWITCH_KNOWN_HOSTS
```

**Vérifier la clé d'hôte avant de la faire confiance.** Celle relevée le
02/09/2026 est `SHA256:nHdxcvdj7qiM/kw9U6APKA0hisP59ArTdYo56UottFo`, et elle est
identique à celle acceptée le 14/08. Si `ssh-keyscan` en rend une autre un jour,
ne pas la poser : quelque chose s'est passé.

Puis, dans GitHub → Settings → **Environments**, créer `production` et y exiger
une validation manuelle. C'est là que vit la liste des personnes autorisées, et
non dans un fichier du dépôt.

---

## 12. Ce que la séance 14 a laissé volontairement de côté

- **La production n'a reçu ni l'extension ni le thème.** Le portail refuse, et
  c'est le comportement voulu.
- **Les produits de démonstration ne sont supprimés nulle part**, ni en
  production ni en préproduction. `purge-demo.sh` a tourné en SIMULATION sur la
  préproduction et sa sélection est juste (42 produits, 13 variations, les cinq
  vrais produits épargnés). Mais son contrôle « cette image sert-elle ailleurs »
  a été corrigé APRÈS cette simulation, et la simulation de contrôle n'a pas pu
  être rejouée : le SSH s'est fermé (§6 octies de `ACCES-REQUIS.md`).
  **À rejouer avant tout `--faire`**, et à comparer aux neuf images partagées
  qu'une vérification indépendante a comptées :

  ```bash
  scp scripts/purge-demo.sh teeshoop:~/ && ssh teeshoop 'chmod 755 ~/purge-demo.sh'
  ssh teeshoop '~/purge-demo.sh'          # simulation, ne supprime rien
  ```

  En production c'est en plus la question 20, elle appartient à l'associé, et le
  script exige un fichier d'autorisation qu'il faut créer et remplir de ses mots.
- **Fancy Product Designer n'est pas désactivé.** Voir
  `docs/FANCY-PRODUCT-DESIGNER.md` : aucune commande n'en dépend, et c'est une
  licence que l'associé a payée.
- **Le studio n'a pas été republié.** Un seul Worker pour deux environnements.
