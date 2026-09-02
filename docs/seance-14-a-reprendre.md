# Séance 14, ce qui reste à reprendre

> Écrite à la fermeture de la séance 14, le 2 septembre 2026. Tout chiffre ici a
> été produit en faisant tourner la chose réelle, contre la vraie boutique ou la
> vraie préproduction. Ce qui n'a pas été mesuré le dit.

---

## 1. Ce qui est vrai maintenant, et qui ne l'était pas ce matin

| | Avant | Après |
|---|---|---|
| Déploiement | rien, jamais fait | une poussée sur `main` livre la préproduction via un exécutant auto-hébergé (o2switch filtre SSH par IP : un exécutant GitHub ne peut pas être autorisé) ; `./scripts/deployer.sh preprod` fait la même chose à la main en 1 min 19 s ; la production refuse au portail |
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
| Total | **23** | **17** | 16 |

**Le 16 de la production n'est pas meilleur, il est moins informé** : l'extension
n'y est pas déployée, donc cinq conditions sur huit ne sont pas regardées et le
portail sort 2 pour le dire.

**Le 17 de la préproduction est le chiffre à comparer en séance 15.** Il est
passé de 16 à 33 quand l'extension y a été déployée (cinq conditions enfin
regardées), puis de 33 à 17 quand l'identité légale et celle de l'hébergeur y ont
été posées. Ce qui reste s'y lit en une ligne : 13 lignes du registre, la TVA, la
médiation et les deux des conditions générales. **Aucune n'est du code.**

---

## 5. Ce qui n'est pas fait, et pourquoi

**La production n'a reçu ni l'extension ni le thème.** Le portail refuse, sans
dérogation, et c'est le comportement voulu. Ce n'est pas un travail à finir :
c'est la porte qui fait son travail.

**LA PURGE EST FAITE, EN PRÉPRODUCTION PUIS EN PRODUCTION**, le 2 septembre 2026,
sur autorisation écrite du propriétaire du dépôt (et non de l'associé, qui n'était
pas joignable ; ses mots sont dans `~/teeshoop-autorisation-purge.txt` sur le
serveur). Les deux passages donnent exactement le même compte :

| | préproduction | production |
|---|---|---|
| produits | **-42** | **-42** |
| variations | -13 | -13 |
| médias | -58 (sur 71 visés, 13 pointaient déjà dans le vide) | -58 |
| termes vidés | -10 | -10 |
| **commandes** | **15, inchangé** | **15, inchangé** |

Vérifié après, sur la vraie boutique : toutes les pages en 200, **zéro erreur
fatale**, la boutique ne montre plus un seul meuble (`Mariposa`, `Palissade`,
`Ventura`, `Trevi`, `Savile Row`, `Gift card` : 0 occurrence), les cinq vrais
produits sont là, et une adresse de produit supprimé rend 404. Un export WXR de
896 ko et une sauvegarde complète ont été pris avant.

Ce qui reste et qui appartient à un humain : les 27 objets de démonstration du
thème (13 modèles Elementor, 5 blocs, 5 dispositions, 3 diapositives, 1 guide des
tailles) et **la page d'accueil, qui est elle-même une page de démonstration de
meubles** (`home-furniture2`). Le script ne les touche pas parce qu'il ne peut pas
savoir lesquels sont utilisés.

*(Paragraphe d'origine, conservé parce qu'il dit ce qui avait été éprouvé avant :)*

**La purge de démonstration n'a jamais supprimé quoi que ce soit, nulle part.**
Sa sélection est juste et mesurée sur la préproduction : 42 produits, 13
variations, les cinq vrais produits épargnés, 15 commandes inchangées.

Le SSH s'est rouvert en fin de séance et la simulation a été rejouée sur la vraie
préproduction :

| | |
|---|---|
| produits sélectionnés | **42** |
| variations emportées | 13 |
| images candidates | **73** |
| supprimées / gardées | 71 / 2 |
| commandes | inchangées |

**Les 2 gardées sont des coïncidences**, et le chiffre ne doit pas se lire
autrement : la source « réglages du site » est large exprès, 298 est un numéro de
menu et 400 une graisse de police. Vérifié précisément : **aucune** des 73 images
n'est citée par Elementor (ni `"id":N`, ni par URL), et aucune n'est une vignette
de catégorie. Le nombre d'images réellement partagées est **zéro**.

**13 des 73 références pointent dans le vide** : la pièce jointe n'existe plus et
seule la ligne `postmeta` demeure. C'est l'écart entre les 69 du SQL et les 57 de
l'API REST, résolu.

Il ne reste que la décision : `--faire`. Rien n'a été supprimé, nulle part.

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

## 6 bis. Les quatre prix provisoires, et où ils sont signalés

L'associé n'est pas joignable et ne le sera pas de sitôt. La décision prise le
2 septembre est donc : **on garde les valeurs supposées, on les signale, et on
n'ouvre pas la boutique avec.** Ce n'est pas un contournement du portail : le
portail continue de refuser sur ces quatre lignes, et c'est ce qui empêche
d'ouvrir.

| Ligne du registre | Ce qu'elle suppose |
|---|---|
| `H-Q06-TARIF-TEE` | un t-shirt une face vaut **14,50 EUR HT** (9,50 de textile + 5,00 de marquage) |
| `H-Q06-TARIF-SWEAT` | un sweat une face vaut **32,00 EUR HT** (27,00 + 5,00) |
| `H-Q06-TARIF-VETEMENT-CLIENT` | vêtement fourni par le client : **12,00 EUR HT** la face |
| `H-Q06-MARQUAGE-FACE-SUP` | chaque face après la première : **6,00 EUR HT** |

Toutes les quatre : `status: assumption`, `level: bloquant`, `reaches: customer,
operator`, sans date de réponse. Question 06.

**Où un opérateur le voit maintenant.** Le marqueur existait et ne s'affichait
qu'en boutique, pour un opérateur connecté (grille de prix, page d'accueil, pied
de page). Il ne paraissait sur **aucun écran d'administration**, c'est-à-dire
précisément là où un opérateur travaille et modifie un prix. `CLAUDE.md` demande
qu'un chiffre provisoire soit signalé « dans l'interface où un opérateur peut le
voir », donc `Hypotheses::admin_note()` l'affiche désormais sur la fiche produit,
la liste des produits, les réglages WooCommerce et l'écran des coûts, avec le
nombre de valeurs concernées, les numéros de questions et un lien vers le
registre. Sur ces écrans-là seulement : un bandeau partout est un bandeau que
personne ne lit.

**Ce qu'un client voit : rien, et c'est délibéré.** La décision est antérieure et
elle tient : « un client qui lit "ces prix sont des hypothèses" n'apprend rien
qu'il puisse utiliser et doute d'un nombre qui est par ailleurs calculé
correctement ». Ce que le client reçoit est la formulation française sous laquelle
chaque chiffre est affiché. Et de toute façon la boutique ne vend pas : aucun
moyen de paiement n'est activé.

**Ce qui reste à faire quand il répondra :** confirmer ou corriger les quatre
nombres, dater la ligne dans `docs/hypotheses.json`, et relancer le portail. Le
compte de refus doit baisser de quatre.

---

## 7. Ce que la séance 15 doit faire en premier

1. **Faire avancer `main`.** C'est la seule chose qui empêche encore le
   déploiement d'exister : la branche par défaut ne contient aucun fichier de
   travail GitHub, donc `push` ne déclenche rien et « Déploiement » n'apparaît
   même pas dans l'onglet Actions. `git merge --ff-only` suffit, `origin/main`
   étant un ancêtre. Voir `docs/DEPLOIEMENT.md`, tout en haut.

   *(Les quatre secrets GitHub, eux, sont posés depuis le 02/09.)*
2. **Faire tourner les deux clés qui ont transité par une conversation** : la clé
   WooCommerce lecture/écriture et la clé secrète Stripe de test. Vérifié cette
   séance : ni l'une ni l'autre ne l'a été.
3. **Rejouer le portail contre les trois installations** et comparer au tableau
   du §4. Une raison neuve est une régression.
4. **Décider des trois boîtes aux lettres** : `legales@`, `ticket@` et `dev@` de
   `teeshoop.com` n'existent pas, et la page des mentions légales publie la
   première.
5. **Et, si l'associé le dit, lancer la purge en vrai.** La simulation est passée
   sur la vraie préproduction (§5) ; il ne manque que la décision.

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

- **le déploiement automatique depuis GitHub.** Il a été déclenché pour de vrai le
  2 septembre et il a échoué à l'étape SSH : **o2switch filtre par adresse IP**, et
  un exécutant GitHub n'y sera jamais. Ce n'est pas une panne, c'est une propriété
  de l'hébergement. `scripts/deployer.sh` fait la même séquence depuis une machine
  autorisée, et l'en-tête du script dit les trois façons de vivre avec ;
- **le déploiement depuis GitHub Actions**, jamais déclenché : les secrets ne sont
  pas posés. Tout ce qui a été fait l'a été à la main, avec la clé restreinte,
  dans le même ordre que le fichier de travail ;
- **la restauration d'une sauvegarde de PRODUCTION**. Seule celle de la
  préproduction a été remontée. Le document dit ce qui change dans l'autre sens ;
- **le studio sur le Worker**, non republié ;
- `scripts/render-verify.mjs` ne va toujours pas au bout, comme depuis le 26 août.
