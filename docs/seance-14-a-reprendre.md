# Séance 14, ce qui reste à reprendre

> Écrite à la fermeture de la séance 14, le 2 septembre 2026. Tout chiffre ici a
> été produit en faisant tourner la chose réelle, contre la vraie boutique ou la
> vraie préproduction. Ce qui n'a pas été mesuré le dit.

---

## 1. Ce qui est vrai maintenant, et qui ne l'était pas ce matin

| | Avant | Après |
|---|---|---|
| Déploiement | rien, jamais fait | un `push` livre la préproduction ; la production est manuelle et refusée par le portail |
| Extension sur un vrai serveur | nulle part | déployée et active en **préproduction** |
| PHP de la boutique | jamais exécuté | l'intégration continue lance la suite entière sur `php:8.1-cli` |
| Migrations | deux tables créables une fois, jamais modifiables | un moteur versionné, ordonné, rejouable |
| Portail de mise en ligne | ne pouvait interroger que le miroir docker | interroge la vraie boutique, et sort 2 quand il n'a pas pu demander |
| Sauvegarde nocturne | **en panne depuis cinq nuits, sans que personne le sache** | passe, mesurée sous l'environnement de cron |
| Données personnelles en préproduction | 70 adresses de vraies personnes | 0, vérifié par un lecteur indépendant |
| Retour arrière | « restaurer une sauvegarde » | 2,9 s pour le code, 18,0 s pour la base, tous deux faits pour de vrai |

---

## 2. Les trois pannes qui existaient déjà et que personne ne voyait

Elles n'ont pas été introduites par cette séance : elles ont été trouvées en
préparant le déploiement, et c'est le déploiement qui allait s'appuyer dessus.

**La sauvegarde nocturne n'avait pas tourné depuis le 28 août.** `cron` impose
`PATH=/usr/bin:/bin`, où `wp-cli` (dans `/usr/local/bin`) est introuvable. Cinq
lignes identiques dans le journal, cinq nuits.

**Et la surveillance ne pouvait pas le dire.** Sous le même `PATH`,
`/usr/bin/php` est **php-cgi**, qui refuse l'option `-r` par laquelle les deux
envois d'alerte passaient. Le script écrivait quand même son état « déjà
signalé », donc les 719 passages suivants se sont tus. Une panne détectée à
chaque passage, annoncée à personne.

**L'alarme « un bon à tirer n'est jamais parti » n'a jamais pu sonner.** Elle
interroge `statut` et `envoye_le` ; la table porte `status` et `created_at`.
MySQL rejette la requête, `get_var` rend NULL, `(int) NULL` vaut 0. Prouvé sur le
miroir : l'ancienne requête donne `Unknown column 'statut'`, la corrigée trouve
**6** messages en échec qui attendent là.

---

## 3. Ce que la relecture adverse a trouvé dans le travail de la séance

Six angles sur le diff, chaque trouvaille confrontée à un lecteur indépendant
chargé de la réfuter. 34 affirmations, 13 ont tenu. Les quatre qui comptent :

**L'aiguilleur rsync laissait sortir des deux répertoires autorisés.** Le paquet
d'options courtes était accepté en bloc. Avec la seule clé de déploiement, en deux
envois : déposer un lien symbolique vers `wp-content/uploads`, puis renvoyer avec
`-K --delete`. Les 2 866 fichiers des téléversements partaient. `rrsync`, l'outil
que cet aiguilleur remplace, désactive exactement `K`, `L` et `k` pour cette
raison. Corrigé et vérifié contre le vrai serveur : un transfert légitime passe,
`-aKz` est refusé par son nom.

**Un second `retour` supprimait l'extension de la production et sortait 0.**
Après un retour réussi, la copie de sauvegarde a été remise en place, donc elle
n'est plus là, donc la branche « il n'y avait rien avant, annuler c'est retirer »
s'appliquait. C'est la commande qu'on tape quand on ne sait plus où on en est.

**Le portail de production posait une question que la clé de déploiement ne peut
pas poser.** Elle a une commande forcée et ne lance que les verbes du script de
déploiement, donc `wp teeshoop lancement` rendait « verbe inconnu », donc le
portail concluait « boutique injoignable » et sortait 2, toujours, quel que soit
l'état réel. Il bloquait pour la mauvaise raison.

**Un déploiement demandé en préproduction republiait le studio sur le Worker de
production.** La condition du travail « studio » ne regardait que le type
d'événement, pas la cible, et il n'y a qu'un Worker pour les deux environnements.

---

## 4. Ce que le portail de mise en ligne dit, aux trois endroits

Rejoué contre chaque installation, ce qui n'avait jamais été fait.

| | Miroir | Préproduction | Production |
|---|---|---|---|
| Sortie | 1 | 1 | **2** |
| Boutique jointe | oui | oui | **non** |
| Total | 27 | **33** | 16 |

**Le 16 de la production n'est pas meilleur, il est moins informé** : l'extension
n'y est pas déployée, donc cinq conditions sur huit ne sont pas regardées et le
portail sort 2 pour le dire. Le 33 de la préproduction est le chiffre à comparer
en séance 15 ; il est plus grand que celui du miroir parce que l'identité légale
et l'hébergeur sont renseignés sur le miroir **et sur le miroir seulement**.

---

## 5. Ce qui n'est pas fait, et pourquoi

**La production n'a reçu ni l'extension ni le thème.** Le portail refuse, sans
dérogation, et c'est le comportement voulu. Ce n'est pas un travail à finir :
c'est la porte qui fait son travail.

**La purge de démonstration n'a jamais supprimé quoi que ce soit, nulle part.**
Sa sélection est juste et mesurée sur la préproduction : 42 produits, 13
variations, les cinq vrais produits épargnés, 15 commandes inchangées.

Son contrôle « cette image sert-elle ailleurs » a été corrigé après cette
simulation, et le SSH s'est fermé avant qu'elle puisse être refaite. Il a donc
été éprouvé **sur le miroir local**, contre un vrai WooCommerce, avec trois
produits fabriqués pour l'occasion dont une image sert aussi à une page
conservée : **2 à supprimer, 1 gardée**, ce qui est la bonne réponse. Et le
canari a été vérifié en cassant la première requête exprès : le script refuse au
lieu de conclure que rien n'est partagé.

Ce qui reste à faire est donc précis : **rejouer le script contre les 42 vrais
produits de la préproduction**, et comparer aux **neuf images partagées** qu'une
vérification indépendante a comptées là-bas. Avant tout `--faire`.

**Fancy Product Designer n'est pas désactivé**, et `docs/FANCY-PRODUCT-DESIGNER.md`
dit pourquoi il peut l'être sans rien perdre : aucune commande n'en dépend,
vérifié cinq fois.

**Le studio n'a pas été republié.** Un seul Worker pour deux environnements.

---

## 6. Le SSH s'est fermé, et c'est nous

`ssh teeshoop` répond « Network is unreachable » alors que la même machine sert
`https://www.teeshoop.com/` en 200 et que `github.com:22` répond. Ce n'est donc
pas le blocage général du port 22 sortant de la séance 13b : c'est cet hôte-là.

La séance a ouvert plus d'une centaine de connexions SSH en quelques heures, sur
un hébergement qui filtre par IP. L'adresse est très probablement bloquée
automatiquement. Cela se rouvre en attendant, ou par cPanel, ou par le Terminal
web.

**La leçon est dans le code et pas seulement ici :** `purge-demo.sh` faisait 215
démarrages de WordPress parce qu'il appelait `wp` une fois par produit et une
fois par image. Il en fait trois maintenant. Un déploiement fait une poignée de
connexions, pas cent.

---

## 7. Ce que la séance 15 doit faire en premier

1. **Rouvrir le SSH**, puis rejouer `~/purge-demo.sh` en simulation et lire le
   nombre d'images gardées. S'il n'est pas de neuf, comprendre pourquoi avant
   d'aller plus loin.
2. **Poser les quatre secrets GitHub** (`ACCES-REQUIS.md` §6 octies) et créer
   l'environnement `production` avec sa validation manuelle. Sans eux, le
   déploiement automatique ne part pas, et il le dit dès la première étape.
3. **Faire tourner les deux clés qui ont transité par une conversation** : la clé
   WooCommerce lecture/écriture et la clé secrète Stripe de test. Vérifié cette
   séance : ni l'une ni l'autre ne l'a été.
4. **Rejouer le portail contre les trois installations** et comparer au tableau
   du §4. Une raison neuve est une régression.
5. **Décider des trois boîtes aux lettres** : `legales@`, `ticket@` et `dev@` de
   `teeshoop.com` n'existent pas, et la page des mentions légales publie la
   première.

---

## 8. Ce qui est mesuré et ce qui ne l'est pas

**Mesuré, en faisant la chose :**

- déploiement complet en préproduction : **17 s**, dont 91 fichiers PHP analysés
  avec le PHP du serveur ;
- retour arrière du code : **2 946 ms**, les trois pages toujours en 200 ;
- restauration complète de la base : **17 989 ms**, 15 commandes retrouvées, et
  un témoin écrit juste avant **disparu**, ce qui est la seule preuve qu'elle a
  remonté le temps ;
- anonymisation : **2 min 3 s**, 70 adresses à 0, relu par un contrôle qui ne
  partage aucun code avec le script ;
- la suite PHP sur `php:8.1-cli` (8.1.34, le correctif exact de la production) :
  **550 puis 561 tests, tous passés** ;
- la clé de déploiement : shell, `cat`, injection par `;` et chemin arbitraire,
  **tous refusés** contre le vrai serveur.

**Pas mesuré, et il faut le savoir :**

- **la purge, avec son contrôle corrigé, contre les 42 vrais produits de la
  préproduction** (§5). La logique est éprouvée sur le miroir, la donnée réelle
  ne l'est pas ;
- **le déploiement depuis GitHub Actions**, jamais déclenché : les secrets ne sont
  pas posés. Tout ce qui a été fait l'a été à la main, avec la clé restreinte,
  dans le même ordre que le fichier de travail ;
- **la restauration d'une sauvegarde de PRODUCTION**. Seule celle de la
  préproduction a été remontée. Le document dit ce qui change dans l'autre sens ;
- **le studio sur le Worker**, non republié ;
- `scripts/render-verify.mjs` ne va toujours pas au bout, comme depuis le 26 août.
