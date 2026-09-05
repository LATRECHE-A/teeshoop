# Les sauvegardes : les quatre dépôts, ce qui les couvre, et la restauration qui a été faite

Ce document dit ce qui est sauvegardé, où, par quoi, à quel prix mesuré, et
comment on remet la boutique debout. Il existe parce que « des sauvegardes
existent » n'est pas un état sur lequel on peut compter : une restauration
qu'on a faite et chronométrée, elle, en est un.

Écrit le 5 septembre 2026. Les chiffres qui suivent ont été produits en faisant
tourner la chose, et ceux qui viennent d'ailleurs le disent.

---

## 1. Les quatre dépôts

Une boutique qui vend du marquage textile ne tient pas dans un seul stockage.
Perdre n'importe lequel des quatre coûte quelque chose de différent.

| Dépôt | Ce que ça coûte de le perdre | Qui le couvre | Où va la copie |
|---|---|---|---|
| La base WordPress | les commandes, les clients, les factures, le compteur de numérotation. Irremplaçable. | `scripts/sauvegarde.sh` | disque o2switch **et** R2, chiffrée |
| `wp-content/uploads` | les photos du catalogue et les pièces jointes. Reconstituable en théorie, pas en pratique. | `scripts/sauvegarde.sh` | disque o2switch **et** R2, chiffrée |
| Le seau R2 `tshop-ar` | **chaque création de client.** Une commande payée que l'atelier ne peut pas imprimer. | `scripts/sauvegarde-r2.mjs` | disque hors de Cloudflare |
| Le dépôt de code | le travail, pas la boutique : elle continue de tourner sans. | git et GitHub | déjà réparti |

Avant cette nuit, deux des quatre n'étaient couverts que par une copie posée sur
le disque de la boutique elle-même, et le troisième n'était pas couvert du tout.

---

## 2. Les créations des clients, c'est-à-dire R2

### Pourquoi c'était le trou le plus sérieux

R2 n'a ni instantané, ni corbeille, ni versionnage. Une suppression est
définitive à la seconde où elle part, et trois façons de la provoquer existent
déjà dans notre propre code, aucune n'étant un bogue :

- `DELETE /api/design/{id}`, l'effacement RGPD, qui supprime tout ce qui porte
  l'identifiant ;
- `POST /api/design/reap`, la rétention, qui supprime en lot ce que la boutique
  n'a pas nommé dans sa liste `keep` ;
- la règle de cycle de vie posée sur le préfixe `ar/`.

Un identifiant de commande absent d'une liste `keep` mal calculée, et l'oeuvre
part. Le client, lui, a fermé son navigateur : il n'existe aucun original
ailleurs. La séance 13 avait écrit que c'était « le trou le plus sérieux qui
reste » ; la séance 14 ne l'a pas fermé.

### Ce qu'il y a dedans, mesuré le 5 septembre 2026

| | |
|---|---:|
| Objets dans `tshop-ar` | **15** |
| Octets | **57 271 429** (57,3 Mo) |
| Sous le préfixe `ar/` (modèles d'essayage) | 15 |
| Sous le préfixe `design/` (créations de clients) | **0** |

**Zéro création de client en production.** Ce n'est pas une bonne nouvelle, c'est
un délai : la boutique n'a pas encore vendu de personnalisation, donc le coffre
se construit avant d'avoir quelque chose à perdre plutôt qu'après. C'est
exactement le moment où il faut le faire.

### Le coffre

```
node scripts/sauvegarde-r2.mjs depuis-r2 tshop-ar ~/sauvegardes-r2/tshop-ar
node scripts/sauvegarde-r2.mjs verifier          ~/sauvegardes-r2/tshop-ar
```

Il est **cumulatif et ne supprime jamais**. Nos clés portent un identifiant tiré
au sort et ne sont pas réécrites : l'ennemi n'est donc pas la corruption, c'est
la disparition. Un objet qui n'est plus dans le seau reste dans le coffre, et le
rapport le NOMME. C'est cette ligne-là qui attrape une fauche ratée.

Mesuré le 5 septembre 2026 :

| | |
|---|---:|
| Première copie, 15 objets, 57,3 Mo | **47,3 s** (1,21 Mo/s) |
| Deuxième passage, rien n'a changé | **1,3 s**, 0 octet relu |
| Empreinte de l'inventaire | `7d60fb74197ce2de…` |

Le deuxième passage ne retélécharge pas ce dont l'etag et la taille n'ont pas
bougé. À quinze objets c'est un confort ; à cinquante gigaoctets de créations
c'est ce qui fait la différence entre une sauvegarde nocturne qui tient et une
qui n'a jamais le temps de finir.

### L'effacement RGPD atteint le coffre, sinon il n'a pas eu lieu

Le coffre ne supprime jamais de lui-même. Mais l'article 17 ne s'arrête pas à la
porte d'une sauvegarde : un coffre où l'oeuvre d'un client resterait après qu'il
a demandé son effacement serait une conservation illicite déguisée en prudence
technique.

```
node scripts/sauvegarde-r2.mjs oublier ~/sauvegardes-r2/tshop-ar <identifiant> \
  --raison="demande d effacement du client, dossier 2026-09-05-001"
```

C'est le seul verbe qui retire quelque chose. Il exige un identifiant précis et
une raison écrite, il retire les octets ET le condensé (l'etag de R2 est un md5
du contenu, et un condensé par objet de ce qu'un client a fait effacer n'a plus
aucun usage), et il laisse la clé, la date et la raison comme trace. Sans cette
trace, la porte réclamerait à jamais un fichier absent et l'opérateur qui a bien
fait son travail verrait rouge.

**Le contrôle est retourné pour ces objets-là** : c'est leur PRÉSENCE qui devient
une anomalie. Et si l'un d'eux est encore dans le seau au passage suivant, le
coffre **refuse de le recopier**, le nomme, et rend 1 :

```
ECHEC : 2 objet(s) effacé(s) du coffre sont TOUJOURS dans le seau :
  ar/Zzgqy3MGw2.glb
  ar/Zzgqy3MGw2.png
        Un effacement RGPD n a pas été jusqu au bout côté R2.
```

C'est une alarme qu'on n'avait pas : elle attrape un effacement fait à moitié.

### Le coffre est fermé et il ne tourne pas deux fois à la fois

- **0700 sur la racine, 0700 sur les répertoires, 0600 sur les fichiers.** Le
  coffre contient l'oeuvre de clients ; le masque par défaut d'une machine
  ordinaire l'aurait rendue lisible par tout compte de cette machine. La racine
  est resserrée à chaque passage, y compris sur un coffre créé avant cette règle.
- **Un verrou par répertoire** (`mkdir`, qui est atomique là où un fichier de
  verrou ne l'est pas). Deux courses simultanées, le cron et quelqu'un à la main,
  écriraient un inventaire qui ne décrit ni l'une ni l'autre. Un verrou de plus
  de douze heures est cassé, bruyamment : refuser indéfiniment sur un verrou
  qu'un plantage a laissé, ce serait arrêter les sauvegardes en silence.

### Ce que le coffre ne rend pas : les métadonnées personnalisées

Mesuré le 5 septembre 2026, sur les deux conventions d'en-tête possibles
(`x-amz-meta-*` et `cf-r2-metadata`) : l'API REST de Cloudflare **ne porte pas**
`custom_metadata`. Relus après écriture, les deux rendent `{}`. `content-type`,
lui, passe et revient.

Nos objets y portent `created`, que `worker/design.ts` lit pour décider si un
dessin est assez vieux pour être fauché. Conséquence à connaître avant d'en avoir
besoin : **un objet restauré porte la date de sa restauration**, donc la
rétention ne le prendra plus. C'est le sens sûr (on ne supprime pas une oeuvre
qu'on vient de sauver), pas le sens neutre. La valeur d'origine reste dans
`INVENTAIRE.json` : elle est déplacée du seau vers le coffre, pas perdue.

La seule façon de la restituer vraiment serait l'API S3 de R2, qui accepte
`x-amz-meta-*` mais demande une signature SigV4. Elle n'a pas été prise :
`sauvegarde-hors-site.sh` doit tourner sur o2switch, où il n'y a **ni node ni
npm** (mesuré le 14/08/2026), et écrire SigV4 en bash pour cet unique gain
n'était pas le bon échange.

---

## 3. La copie hors du disque de la boutique

### Pourquoi

`sauvegarde.sh` écrit dans `~/sauvegardes`, sur le même disque que la boutique.
Cela protège d'une bêtise humaine et d'une mise à jour ratée. Le jour où le
disque part, cela ne protège de rien : on perd la boutique et sa seule copie
ensemble. Et o2switch ne donne à ce compte **aucune sauvegarde en libre-service**
(mesuré le 27/08/2026 : `uapi Backup list_backups` répond que la fonctionnalité
n'est pas disponible, il n'y a pas de client JetBackup, `~/backups` n'existe pas).

### Pourquoi R2 et pas un autre serveur

Cloudflare est déjà notre fournisseur : pas de contrat de plus, pas de machine de
plus à maintenir en vie, et un domaine de panne qui n'est pas celui d'o2switch.
Le transport est l'API REST de Cloudflare et non l'API S3, parce qu'elle prend un
jeton sur l'en-tête `Authorization` : `curl` suffit, il n'y a pas de signature à
écrire, et **il n'y a ni node ni npm sur le serveur**.

### Pourquoi c'est chiffré avant de partir

`base.sql.gz` contient les commandes, les noms, les adresses et les courriels de
tous les clients. Un seau mal configuré ou un jeton qui fuit ne doit pas valoir la
base clients. Le chiffre est fait sur le serveur, avant l'envoi :
AES-256-CBC, dérivation PBKDF2-SHA512 à 200 000 itérations, sel aléatoire.

Ce qu'il protège : la copie au repos chez Cloudflare. Ce qu'il ne protège pas :
une compromission du serveur o2switch lui-même, où la phrase de passe se trouve
aussi. Dit autrement, il couvre le risque réel (une erreur de configuration à
distance), pas le risque total.

**Perdre la phrase de passe, c'est perdre la sauvegarde.** Elle vit dans
`~/.config/teeshoop/sauvegarde.cle` en mode 600 et sa copie va dans le
gestionnaire de mots de passe. Nulle part ailleurs, et jamais dans le dépôt.

### Pourquoi c'est découpé

Un envoi en une seule requête a un plafond que l'API ne documente pas, et
`uploads.tar.gz` pèse 287 Mo. Le découpage en morceaux de 64 Mio retire
l'inconnue et rend chaque morceau vérifiable séparément. Mesuré le 5 septembre
2026 : un PUT de 67 108 864 octets passe.

### Ce que ça coûte, mesuré le 5 septembre 2026

Sur une sauvegarde de forme réaliste (146 Mo : une base de 6 Mo, des
téléversements de 140 Mo, `wp-config.php` et le manifeste), depuis cette
machine-ci :

| | |
|---|---:|
| Chiffrement, découpage, envoi et relecture | **182 s** (0,80 Mo/s) |
| Objets écrits | 6 morceaux, plus l'inventaire |
| Morceaux de `uploads.tar.gz` | 64 Mio, 64 Mio, 5,5 Mo |
| Ce que le chiffre ajoute | 32 octets par fichier (sel plus remplissage) |

Extrapolé à la sauvegarde réelle (293 Mo, mesurée le 28/08/2026 sur le serveur),
le même débit donnerait environ **six minutes par nuit**. Ce chiffre-là est une
règle de trois, pas une mesure : le débit d'o2switch vers Cloudflare n'a pas pu
être mesuré cette nuit, le port 22 étant filtré depuis cette machine.

Au tarif R2 publié (0,015 USD par Go et par mois de stockage, écritures à
4,50 USD le million, sortie gratuite), sept nuits de 293 Mo font environ 2 Go,
soit de l'ordre de **0,03 USD par mois**. À confirmer sur la première facture :
c'est une arithmétique sur un tarif affiché, pas un relevé.

---

## 4. La restauration, faite pour de vrai

Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde. Voici les
deux aller-retours qui ont été exécutés le 5 septembre 2026, pas décrits.

### Les créations : destruction réelle puis restauration

La production n'a pas été touchée : une sauvegarde est une lecture et elle le
reste. L'essai s'est fait sur un seau témoin, `teeshoop-restauration-essai`,
rempli avec les quinze objets réels de la production, donc sur les mêmes octets
et la même infrastructure.

```
1. sauvegarde du seau témoin vers le disque   15 objets, 57 271 429 o, 44,3 s
2. porte de vérification                       verte, empreinte 7d60fb74…
3. DESTRUCTION des 15 objets dans R2           15 supprimés (wrangler r2 object delete)
4. le seau est vide                            0 objet, confirmé par une relecture
5. restauration depuis le coffre               15 objets écrits, 68 s
6. comparaison octet à octet, relue depuis R2  15 objets, 57 271 429 o, identiques
```

L'empreinte de l'inventaire du seau témoin après l'aller-retour vaut
`7d60fb74197ce2deae9922d3ff18e34ff343c833088b6f4c1ddb9375a46b1163`, c'est-à-dire
exactement celle du seau de production. Aucun octet n'a bougé.

Entre l'étape 4 et l'étape 5, la comparaison a été lancée par accident sur un
seau vide. Elle a rendu quinze lignes « absent du seau » et une sortie 1. C'est
la preuve la moins préméditée et la plus utile du lot : la porte sait dire non.

### La boutique : l'aller-retour chiffré

```
./scripts/sauvegarde-hors-site.sh --restaurer <horodatage> <destination>
```

Il rapatrie l'inventaire depuis le seau, télécharge chaque morceau, recolle,
déchiffre, et **compare le sha256 au clair d'origine** fichier par fichier. Une
restauration qui ne compare pas n'est pas une restauration, c'est une copie.

Résultat mesuré, voir la section 6 pour la sortie brute.

### Ce que les deux ne disent pas

Aucun des deux ne remonte un WordPress qui vend. Cette moitié-là a été faite le
28/08/2026 et vit dans `docs/EXPLOITATION.md` : le dump remonte dans une base
d'essai, jamais par-dessus la vraie, et il a été chronométré.

---

## 5. Les portes, et la preuve qu'elles savent tomber

`verifier` relit chaque fichier du coffre et recalcule chaque empreinte. Il ne
croit pas l'inventaire : il le confirme ou il le contredit. Il a été cassé
exprès quatre fois le 5 septembre 2026, et il est tombé les quatre fois.

| Ce qui a été cassé | Ce que la porte a dit | Sortie |
|---|---|---:|
| un objet retiré du coffre | `ar/Zzgqy3MGw2.png : le fichier … manque` | 1 |
| un octet retourné dans un objet | `sha256 03a731bc… contre 520793b4… à l inventaire` | 1 |
| un fichier de plus, non inventorié | `objets/ar/intrus.png : présent sur le disque et absent de l inventaire` | 1 |
| l'empreinte de la liste falsifiée | `l empreinte vaut 7d60fb74… et l inventaire annonce 0000…` | 1 |
| tout remis droit | `ok : chaque objet … à la bonne taille et à la bonne empreinte` | 0 |

Du côté de la copie hors site, les mêmes essais ont été faits contre R2 :

| Ce qui a été cassé | Ce que la restauration a dit | Sortie |
|---|---|---:|
| quatre octets retournés dans un morceau, taille inchangée | `base.sql.gz : sha256 95c549bc… contre 55d279cd… à l inventaire` | 1 |
| un morceau supprimé du seau | `MANIFESTE.txt.chiffre.aa : lecture impossible` | 1 |
| le vérificateur node sur la même copie abîmée | `base.sql.gz.chiffre.aa : sha256 805ed0fe… dans le seau contre 796a6c05… à l inventaire` | 1 |
| une copie saine reprise ensuite | `ok : chaque objet de l inventaire est dans le seau` | 0 |

La troisième ligne est celle qui compte : c'est un programme node qui a trouvé
l'erreur dans ce qu'un programme bash avait écrit, sans partager une ligne de
code avec lui.

Trois refus supplémentaires ont été prouvés de la même façon :

- **Un seau vide n'est pas une sauvegarde verte.** « Rien trouvé » et « rien
  regardé » ne se distinguent pas depuis l'extérieur, donc zéro objet rend 1, et
  il faut `--vide-permis` pour dire explicitement le contraire.
- **Aucun identifiant refuse tout.** Sans jeton, le script ne dit pas « rien à
  sauvegarder », il dit qu'il n'a rien pu lire et rend 1.
- **`vers-r2` refuse `tshop-ar`** sans `--je-restaure-la-production`, et n'écrase
  aucun objet existant sans `--ecraser`. Le scénario réel est « des objets ont
  disparu, remets ceux-là » : écraser des objets vivants avec des copies plus
  vieilles serait une seconde catastrophe.
- **`oublier` exige une raison écrite** et refuse un identifiant qui n'en est pas
  un. Un effacement se justifie ; il ne s'improvise pas en ligne de commande.
- **Un contrôle qui n'a rien relu n'est pas vert.** Si tous les objets d'un
  coffre ont été effacés à la demande de clients, `verifier` le dit et rend 1 :
  c'est un état légitime, et ce n'est plus un coffre.

### Une porte de plus, trouvée en la mesurant

`--lister` annonçait « 2 objets, 1 432 octets » sur un préfixe qui en portait
trois, le troisième pesant 3 Mo. Cause mesurée le 5 septembre 2026 : **GNU sed ne
termine pas sa dernière ligne** quand son entrée ne l'était pas, et `while read`
abandonne une ligne non terminée. `cut` et `awk` ajoutent le saut de ligne, ce qui
rendait le défaut invisible partout où l'un des deux se trouvait au milieu du
tuyau, y compris dans la rotation.

Un compte faux dans un outil de sauvegarde est pire qu'une erreur : c'est une
erreur rassurante. Après correction, deux lecteurs qui ne partagent aucun code
donnent le même chiffre : 3 objets, 3 001 464 octets.

### L'état des seaux, mesuré

`wrangler r2 bucket dev-url get` répond « Public access via the r2.dev URL is
disabled » sur `tshop-ar` **et** sur `teeshoop-sauvegardes`. Ni l'un ni l'autre
n'est atteignable sans identifiant. C'est un contrôle à refaire après toute
manipulation dans le tableau de bord, parce qu'une URL atteignable est publique
et qu'un seau de sauvegarde ouvert, c'est la base clients ouverte.

### Les codes de sortie, et pourquoi il y en a quatre

`sauvegarde-r2.mjs` rend 0 (tout va bien), 1 (quelque chose ne va pas), 2
(mauvais usage) et **3 (la sauvegarde est complète, mais des objets ont disparu
du seau)**.

Trois est un code à part parce que ces deux nouvelles ne se traitent pas pareil.
« La sauvegarde n'a pas tourné » réveille quelqu'un. « Un objet a disparu du
seau » se lit le matin, et ce peut être un effacement RGPD parfaitement légitime.
Les confondre est la façon la plus sûre de faire ignorer les deux.

Le même raisonnement donne le **code 2 de `sauvegarde.sh`** : la sauvegarde
locale est complète mais la copie hors site a échoué. La boutique est
sauvegardée, elle ne l'est qu'à un seul endroit, et quelqu'un doit regarder.
Une copie hors site **non configurée** ne rend pas 2 : c'est un état choisi, le
manifeste le dit, et faire sonner la sauvegarde toutes les nuits pour cela est
le meilleur moyen de couper la sonnerie.

Les trois branches ont été exécutées le 5 septembre 2026, contre un WordPress
simulé (un `wp` de substitution, un `wp-config.php`, des téléversements) :

| Situation | Sortie | Ce que dit le manifeste |
|---|---:|---|
| hors site non configuré | 0 | `NON CONFIGURÉE : cette copie n'existe que sur le disque` |
| hors site configuré, envoi réussi | 0 | `configurée, tentée juste après cette sauvegarde` |
| hors site configuré, envoi en échec | **2** | idem, et les quatre fichiers locaux sont intacts |

**DEUX APPELANTS DOIVENT APPRENDRE À LIRE LE 2, et ils ne sont pas dans ce
lot.** `scripts/purge-demo.sh` fait `"$HOME/sauvegarde.sh" … || echec "la
sauvegarde préalable a échoué, rien ne sera supprimé"`, et `verbe_sauvegarder`
dans `scripts/deploiement.sh` rend le code tel quel. Avec un 2, les deux
refusent d'aller plus loin : c'est le sens sûr (rien n'est supprimé, rien n'est
déployé), mais le message de `purge-demo.sh` dit alors quelque chose de faux,
puisque la sauvegarde locale est bel et bien complète. La ligne de
`sauvegarde.sh` qui précède, elle, dit la vérité, donc l'opérateur voit les deux.

La correction tient en un test par appelant (`rc=$?; [ "$rc" -eq 0 ] ||
[ "$rc" -eq 2 ] || echec …`) et appartient à qui tient ces deux fichiers.

---

## 6. Ce qui reste à brancher, et par qui

Rien de ce qui suit n'est du travail de développement. Ce sont des accès et des
lignes de cron. Le détail exact, commande par commande, est dans
`ACCES-REQUIS.md`, section 14 quater.

1. **Un jeton Cloudflare R2** dans `~/.config/teeshoop/r2.env` sur o2switch et
   sur la machine du développeur. Sans lui, la copie hors site ne part pas et le
   coffre des créations ne se remplit que quand quelqu'un a une session wrangler
   ouverte. Le jeton de session de wrangler expire : ce n'est pas un identifiant
   de cron.
2. **Une phrase de passe** dans `~/.config/teeshoop/sauvegarde.cle`, mode 600, au
   moins 32 octets tirés au sort, copiée dans le gestionnaire de mots de passe.
3. **Déposer `sauvegarde-hors-site.sh` dans `~` sur o2switch**, à côté de
   `sauvegarde.sh`, et le rendre exécutable. Il demande SSH, qui est filtré
   depuis cette machine cette nuit.
4. **Une ligne de cron pour le coffre des créations**, sur une machine qui a
   node, donc pas o2switch. Sur la machine du développeur :

   ```
   PATH=/usr/local/bin:/usr/bin:/bin
   17 4 * * * cd /home/LTH/tshop && node scripts/sauvegarde-r2.mjs depuis-r2 tshop-ar "$HOME/sauvegardes-r2/tshop-ar" >> "$HOME/sauvegardes-r2/journal.log" 2>&1 && node scripts/sauvegarde-r2.mjs verifier "$HOME/sauvegardes-r2/tshop-ar" >> "$HOME/sauvegardes-r2/journal.log" 2>&1
   ```

   **La vérification fait partie de la ligne, elle n'est pas facultative.** La
   copie fait confiance à l'etag et à la taille pour ne pas retélécharger ce qui
   n'a pas bougé ; c'est `verifier` qui relit les octets et recalcule les
   empreintes. Sans lui, une corruption sur le disque du coffre n'est jamais vue.

   Le `PATH` explicite n'est pas de la superstition : `sauvegarde.sh` a échoué
   cinq nuits de suite parce que le PATH de cron ne contient pas
   `/usr/local/bin`.

5. **La veille doit regarder la copie hors site**, ce qu'elle ne fait pas encore.
   `scripts/veille.sh` surveille la fraîcheur de `~/sauvegardes` ; il lui manque
   le pendant hors site. Le contrôle tient en une ligne et ne demande aucun
   couplage :

   ```
   test -n "$(find "$SAUVEGARDES" -maxdepth 2 -name RECU-HORS-SITE.txt -mmin -1500)"
   ```

   Un reçu de moins de 25 heures existe, ou la copie hors site a cessé de partir.

---

## 7. Ce que ce dispositif ne couvre toujours pas

Dit ici plutôt que découvert un mauvais jour.

- **Le coffre des créations dépend d'une machine qui a node**, c'est-à-dire de
  celle du développeur. Si elle est éteinte, il ne tourne pas. Les deux façons de
  le rendre autonome demandent chacune une décision : un cron de Worker
  Cloudflare (qui suppose un déploiement, donc à faire à un moment où toucher au
  Worker est sans risque, puisqu'un seul Worker sert la production et la
  préproduction), ou un travail programmé GitHub Actions (qui suppose de poser le
  jeton R2 dans les secrets du dépôt).
- **La copie hors site vit dans le même compte Cloudflare que le seau qu'elle
  double.** Une perte du compte, ou une facture impayée, emporterait les deux.
  Le coffre des créations, lui, est sur un disque hors de Cloudflare, donc les
  deux stockages ne tombent pas ensemble. Un troisième emplacement pour la base
  reste une décision à prendre.
- **La rotation supprime.** Sept copies hors site, sept locales. Une erreur
  découverte au bout de huit jours n'a plus de version antérieure à laquelle
  revenir. C'est un réglage, pas une fatalité : `KEEP` est un argument.
- **Rien de tout cela n'a tourné sur o2switch cette nuit.** Le port 22 est filtré
  depuis cette machine (l'adresse publique a changé, elle vaut 176.191.78.140).
  Le mécanisme est prouvé de bout en bout ici, contre la vraie infrastructure R2 ;
  ce qui reste est de le déposer là-bas.
