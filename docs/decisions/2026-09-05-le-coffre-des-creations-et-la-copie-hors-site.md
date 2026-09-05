# 5 septembre 2026 : le coffre des créations, et la sauvegarde qui quitte enfin le disque

Ce document enregistre les arbitrages pris seul, la nuit, sur l'item 6 du brief
(les sauvegardes là où elles manquent), avec ce qui a été mesuré pour chacun. Il
est là pour qu'un lecteur de dans dix-huit mois n'ait pas à refaire le
raisonnement, et pour qu'il sache lesquels sont des échanges plutôt que des
évidences.

Les deux trous, tels que le brief les pose :

- (a) les sauvegardes vivent sur le même disque que le site ;
- (b) R2, qui détient chaque création de client, n'a aucune sauvegarde.

---

## 1. Le transport est l'API REST de Cloudflare, pas l'API S3 de R2

**Deux lectures.** R2 parle S3, et le monde entier sauvegarde vers S3 avec
`rclone` ou `aws s3 sync`. C'est la voie évidente. L'autre est l'API REST de
Cloudflare, `/accounts/{compte}/r2/buckets/{seau}/objects`, qui prend un jeton
sur l'en-tête `Authorization`.

**Ce qui tranche : il n'y a ni node ni npm sur le serveur o2switch** (mesuré le
14/08/2026), et la copie hors site doit partir de là. S3 impose une signature
SigV4 par requête, qu'il faudrait écrire en bash. L'API REST ne demande que
`curl`, qui est là.

**Ce que ça coûte, mesuré le 05/09/2026 :** l'API REST **ne porte pas**
`custom_metadata`. Les deux conventions d'en-tête ont été essayées
(`x-amz-meta-created` et `cf-r2-metadata`), l'objet a été relu après chaque
écriture, et les deux rendent `{}`. `content-type` passe et revient.

Nos objets portent `created`, que `worker/design.ts` lit pour décider si un
dessin est assez vieux pour être fauché. Un objet restauré porte donc la date de
sa restauration et la rétention ne le prendra plus. C'est le sens sûr, pas le
sens neutre, et l'inventaire garde la valeur d'origine : elle est déplacée du
seau vers le coffre, pas perdue. L'échange a été jugé bon : perdre une date de
rétention sur des objets qu'on vient de sauver d'une disparition coûte moins que
ne pas pouvoir les sauver du tout.

**Ce que ça a permis en plus, et qui n'était pas prévu :** la même API a servi à
mesurer le contenu réel du seau de production cette nuit, avec la session
wrangler déjà ouverte, sans créer le moindre identifiant. `wrangler` n'a pas de
`r2 object list`, donc sans cette API il n'y aurait eu aucun chiffre.

---

## 2. La destination hors site est R2, dans notre propre compte

**Deux lectures.** Un second hébergeur (un VPS, un NAS, un autre fournisseur
d'objets) isole mieux : la perte du compte Cloudflare n'emporte alors rien. Mais
c'est un contrat de plus, une machine de plus à maintenir en vie, et une chose de
plus dont personne ne s'occupe au bout de six mois.

**Choisi : R2.** Cloudflare est déjà notre fournisseur, le domaine de panne n'est
pas celui d'o2switch, la sortie est gratuite (donc une restauration ne coûte
rien, ce qui n'est pas vrai partout), et il n'y a rien de neuf à administrer.

**Ce que ça ne couvre pas, écrit noir sur blanc dans `docs/SAUVEGARDES.md` :**
la copie hors site de la boutique vit dans le même compte Cloudflare que le seau
`tshop-ar` qu'elle ne double pas. Une perte du compte, ou une facture impayée,
emporterait les deux. Le coffre des créations, lui, est sur un disque hors de
Cloudflare, donc les deux stockages ne tombent pas ensemble. Un troisième
emplacement pour la base reste une décision à prendre, et elle appartient à
l'associé parce qu'elle coûte de l'argent.

---

## 3. La base part chiffrée, et la clé ne quitte pas le serveur

`base.sql.gz` contient les commandes, les noms, les adresses et les courriels de
tous les clients. Un seau mal configuré ou un jeton qui fuit ne doit pas valoir
la base clients : la règle du projet est qu'une URL atteignable est publique.
AES-256-CBC, PBKDF2-SHA512 à 200 000 itérations, sel aléatoire, phrase de passe
dans un fichier en mode 600 que le script refuse de lire s'il est plus ouvert que
cela.

**Le refus est explicite plutôt que dégradé.** Si `openssl` ne connaît pas
`-pbkdf2` (avant 1.1.1), il dérive la clé avec un MD5 à une itération. Le script
essaie l'option et **refuse de partir** plutôt que de chiffrer faiblement en
silence.

**Ce que ça ne protège pas :** une compromission d'o2switch, où la phrase de
passe se trouve aussi. Le chiffre couvre le risque réel (une erreur de
configuration à distance, un jeton qui fuit), pas le risque total.

**Le prix à payer est nommé :** perdre la phrase de passe, c'est perdre la
sauvegarde. C'est pour cela qu'elle a une ligne à elle dans `ACCES-REQUIS.md` et
qu'elle doit exister en deux endroits, le serveur et le gestionnaire de mots de
passe.

---

## 4. Le coffre des créations est cumulatif et ne supprime jamais

**Deux lectures.** Un miroir fidèle (ce qui disparaît du seau disparaît du
coffre) est le comportement habituel de `rsync --delete` et de `aws s3 sync
--delete`. Il est ici exactement à l'envers du besoin.

Nos clés portent un identifiant tiré au sort et ne sont jamais réécrites :
l'ennemi n'est pas la corruption, c'est la disparition. Et trois mécanismes de
suppression existent déjà dans notre propre code, aucun n'étant un bogue :
l'effacement RGPD, la fauche de rétention, et la règle de cycle de vie sur `ar/`.
Un miroir fidèle propagerait sagement la catastrophe qu'il est censé réparer.

**Choisi : le coffre garde tout, et NOMME ce qui a disparu du seau.** Un objet
absent du seau reste sur le disque, l'inventaire le marque, le rapport l'écrit,
et la sortie vaut 3 au lieu de 0.

**Pourquoi 3 et pas 1.** « La sauvegarde n'a pas tourné » réveille quelqu'un ;
« un objet a disparu du seau » se lit le matin et peut être un effacement RGPD
parfaitement légitime. Les confondre est la façon la plus sûre de faire ignorer
les deux. Le même raisonnement donne le code 2 de `sauvegarde.sh` : sauvegarde
locale complète, copie hors site en échec.

**La tension à connaître :** cela laisse dans le coffre l'oeuvre d'un client qui
a demandé son effacement RGPD. Le coffre est un fichier local en mode 600 sur une
machine du développeur, pas un service ; la procédure d'effacement doit donc le
nommer parmi les endroits à purger. Ce point est à porter dans `docs/RGPD.md`,
qui n'a pas été touché cette nuit et qui appartient à une autre passe.

---

## 5. Un seul format d'inventaire, deux écrivains, un vérificateur qui ne partage
   pas leur code

Le format `teeshoop-inventaire-1` est écrit par deux programmes : le coffre des
créations (node, sur une machine qui a node) et la copie hors site (bash, sur un
serveur qui n'en a pas). Deux implémentations, parce que deux machines n'ont pas
le même outillage, et c'est le genre de duplication que le brief interdit.

**Ce qui est dédupliqué est ce qui compte : le vérificateur.** Un seul,
`sauvegarde-r2.mjs comparer`, relit les octets DEPUIS R2 et recalcule les
empreintes, et il n'a pas une ligne commune avec le script bash qui les a
écrites. Relire un écrivain avec son propre lecteur ne prouve que sa cohérence
avec lui-même : c'est la raison pour laquelle `scripts/dtf-verify.mjs` ouvre le
ZIP avec un lecteur écrit à la main, et c'est la même ici.

Mesuré le 05/09/2026 : le vérificateur node a relu les six objets écrits par le
script bash, 146 000 176 octets, depuis R2, et les a trouvés identiques.

---

## 6. La restauration ne peut pas toucher la production par accident

`vers-r2` refuse le seau `tshop-ar` sans `--je-restaure-la-production`, et
n'écrase aucun objet existant sans `--ecraser`.

Le second garde-fou est le moins évident et le plus utile. Le scénario réel n'est
pas « le seau est vide, remets tout » mais « des objets ont disparu, remets
ceux-là ». Écraser des objets vivants avec des copies plus anciennes ferait de la
sauvegarde la panne.

L'aller-retour a donc été prouvé sur un seau témoin rempli avec les quinze objets
réels de la production : sauvegarde, destruction réelle des quinze objets dans
R2, restauration, comparaison octet à octet relue depuis R2. L'empreinte de
l'inventaire après l'aller-retour vaut exactement celle du seau de production,
`7d60fb74197ce2deae9922d3ff18e34ff343c833088b6f4c1ddb9375a46b1163`.

---

## 6 bis. Les trois défauts que la passe adversariale a trouvés sur ce diff

Ils sont écrits ici parce que le brief demande de dire ce que le changement a
failli faire, même corrigé.

**Un effacement RGPD que la sauvegarde aurait annulé.** Le coffre ne supprime
jamais, ce qui est juste contre la disparition et faux contre l'article 17 : il
n'y avait aucune façon supportée de retirer l'oeuvre d'un client qui la demande,
et `rm` à la main aurait rendu la porte rouge à jamais. D'où le verbe `oublier`,
la trace qui reste, le contrôle retourné dans `verifier`, et l'alarme quand un
objet effacé du coffre est encore dans le seau (un effacement fait à moitié).

**Une vignette de panier qui ne se serait plus affichée.** `serveDesignFile` rend
le content-type STOCKÉ et pose `nosniff` : un `preview.png` restauré sans type
est refusé par le navigateur, donc la vignette du panier et l'image du bon a
tirer deviennent des cadres vides. Le chemin de restauration restitue bien le
type (l'API REST le porte, contrairement à `custom_metadata`), et il NOMME
désormais les objets restaurés sans type au lieu de les passer sous silence.
`serveAr`, lui, impose le type d'après l'extension et ne craint rien : la
différence entre les deux routes n'était écrite nulle part.

**Un compte faux et rassurant.** `--lister` annonçait deux objets sur trois,
parce que GNU sed ne termine pas sa dernière ligne et que `while read` abandonne
une ligne non terminée. `cut` et `awk` la rétablissent, ce qui masquait le défaut
partout où l'un des deux se trouvait dans le tuyau, y compris dans la rotation,
qui supprimait donc correctement par accident. Corrigé à la source.

Trois durcissements sont venus de la même passe : le coffre est en 0700 et ses
fichiers en 0600 (le masque par défaut l'aurait rendu lisible par tout compte de
la machine), un verrou empêche deux courses simultanées d'écrire un inventaire
qui ne décrit ni l'une ni l'autre, et le fichier d'identifiants est refusé s'il
n'est pas en 600, parce que le script bash l'EXÉCUTE au lieu de le lire.

---

## 7. Deux seaux ont été créés, aucun Worker n'a été déployé

Le brief est explicite : un seul Worker sert la production et la préproduction,
donc rien de non additif cette nuit et surtout pas de `wrangler deploy`. Une
sauvegarde est une lecture et elle l'est restée : le seul chemin d'écriture est
`vers-r2`, et il n'a jamais visé `tshop-ar`.

Créer un seau est additif et ne change rien à ce que voit un client. Trois l'ont
été : `teeshoop-sauvegardes`, destination de la copie hors site, gardé vide en fin
de nuit ; `teeshoop-restauration-essai`, qui a servi à l'aller-retour ; et
`teeshoop-seau-vide-essai`, qui a servi à prouver qu'un seau vide ne passe pas
pour une sauvegarde. Les deux derniers ont été vidés et supprimés. `wrangler.jsonc`
n'a pas été modifié : wrangler propose d'ajouter la liaison, il a répondu non en
mode non interactif, et c'est le bon état, puisqu'aucun Worker ne lit ces
seaux-là.

État du compte à la fin de la nuit : `tshop-ar` (15 objets, intact, jamais écrit)
et `teeshoop-sauvegardes` (0 objet). Les deux ont `dev-url` désactivé, vérifié.

---

## 8. Ce qui n'a pas été fait, et pourquoi

- **Rien n'a tourné sur o2switch.** Le port 22 est filtré depuis cette machine
  (l'adresse publique a changé, elle vaut 176.191.78.140). Le mécanisme est
  prouvé de bout en bout ici, contre la vraie infrastructure R2 ; ce qui reste
  est de déposer le script là-bas et d'y poser deux fichiers de configuration.
- **La veille ne regarde pas encore la copie hors site.** `scripts/veille.sh`
  appartient à une autre passe cette nuit ; le contrôle exact, qui tient en une
  ligne et ne demande aucun couplage, est écrit dans `docs/SAUVEGARDES.md`.
- **Le coffre des créations n'a pas d'horloge à lui.** Il tourne sur une machine
  qui a node, donc pas o2switch. Les deux façons de le rendre autonome (un cron
  de Worker, un travail programmé GitHub Actions) demandent l'une un déploiement
  et l'autre un secret de dépôt, et aucune des deux n'était à prendre cette nuit
  sans que quelqu'un décide.
