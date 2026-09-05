# Mise en ligne : ce que les séances 14 et 15 doivent lire

> **Le 5 septembre 2026, le portail est devenu deux portes.** La décision est du
> développeur et elle est écrite dans `docs/decisions/2026-09-05-les-deux-portes.md`.
> Ce qui coûte de l'argent refuse toujours (`--porte=argent`, sans dérogation) ; le reste
> est écrit, daté et nominatif dans `docs/DETTE-LANCEMENT.md` par `--porte=publication`,
> qui sort 0. Ce document décrit d'abord le portail complet, qui n'a pas changé et que
> `scripts/deployer.sh` et l'intégration continue appellent toujours sans porte, puis les
> deux portes, au chapitre qui leur est consacré plus bas.

Ce document existe parce que le portail de mise en ligne a été construit en séance 13b,
branché dans `npm run ci` sur la machine du développeur, et **dans aucun travail
d'intégration continue**. Il a donc passé une journée à ne tourner nulle part sauf à la
main. Une porte qui ne s'ouvre que quand on pense à la pousser n'est pas une porte.

Il est maintenant dans `.github/workflows/ci.yml`, avec sa propre étape d'auto-test, et il
est ici, dans un fichier suivi par git, parce que `prompts/` ne l'est pas : une consigne qui
ne vit que dans un fichier ignoré ne survit pas à la séance qui l'a écrite.

---

## La seule commande

```bash
npm run verify:lancement
```

Elle sort **0** quand la boutique peut être mise en ligne et **non zéro** quand elle ne le
peut pas. À la question « peut-on lancer », il n'y a que deux réponses et il n'y a pas de
« oui mais ».

Le code de sortie distingue en revanche deux refus, **depuis la séance 14**, et un
déploiement a besoin de cette distinction :

| Code | Ce que ça veut dire | Ce qu'il faut faire |
|---|---|---|
| `0` | rien ne refuse | lancer |
| `1` | quelque chose refuse, **et on a bien pu demander** | corriger ce que le portail nomme |
| `2` | **on n'a pas pu demander** : registre illisible, boutique injoignable | réparer l'accès, puis redemander |

`2` n'est pas « pire que 1 ». Les deux bloquent. Ils diffèrent par ce qu'un opérateur doit
faire ensuite, et un journal de déploiement qui n'écrit que « refusé » envoie quelqu'un
chercher au mauvais endroit un vendredi à dix-neuf heures. Avant la séance 14, une boutique
injoignable sortait **1**, comme un refus ordinaire, alors que l'en-tête du script annonçait
déjà 2 : les deux cas étaient indiscernables.

Huit formes, pour huit moments :

| Commande | Ce qu'elle demande | Qui s'en sert |
|---|---|---|
| `npm run verify:lancement` | « Peut-on lancer ? » Le registre **et** le miroir local | Le développeur |
| `node scripts/launch-gate.mjs --boutique=ssh:teeshoop:~/public_html` | La même question, posée à **la vraie boutique**, avec une clé qui peut lancer wp-cli | Le développeur |
| `node scripts/launch-gate.mjs --boutique=deploy:teeshoop:prod` | La même question, par le verbe `verdict` de `deploiement.sh` | **Le déploiement**, dont la clé restreinte ne peut lancer que ça |
| `node scripts/launch-gate.mjs --json --boutique=…` | La même chose, lisible par un programme | Le déploiement, qui archive le verdict |
| `node scripts/launch-gate.mjs --depot --ci` | « Ce portail fonctionne-t-il ? » Le registre seul, sans WordPress | L'intégration continue |
| `node scripts/launch-gate.mjs --self-test` | « Ce portail sait-il encore refuser ? » | L'intégration continue |
| `node scripts/launch-gate.mjs --porte=argent --boutique=…` | « Est-ce qu'on peut vendre sans perdre d'argent ? » | Le déploiement, avant d'ouvrir la caisse |
| `node scripts/launch-gate.mjs --porte=publication --boutique=…` | « Qu'est-ce qu'on doit encore, et à qui ? » Sort 0 et écrit le relevé | Le déploiement, et l'intégration continue |

**La forme `--boutique=ssh:` n'existait pas avant la séance 14**, et son absence était un trou : trois
documents suivis par git demandaient de rejouer le portail contre la production, et le code
interrogeait un `docker compose` du miroir local écrit en dur, sans option ni variable
d'environnement. Les deux extrémités exécutent maintenant la même chose,
`wp teeshoop lancement --porcelaine`, une sous-commande WP-CLI et non plus un programme PHP
expédié à travers ssh et un shell : les guillemets, les antislashs et les accents d'un tel
envoi produisent, quand ils se passent mal, une erreur d'analyse qui ressemble exactement à
une boutique injoignable.

Un argument inconnu **refuse** désormais au lieu d'être ignoré. `--boutque=ssh:…`, une
lettre en moins, aurait interrogé le miroir local et imprimé un verdict sur la mauvaise
boutique, dans le seul outil dont tout le travail est d'être cru.

`--depot --ci` sort 0 même sur un refus, **par construction** : l'intégration continue n'a
pas de boutique à interroger et ne peut donc pas répondre à la première question. C'est
exactement pour cela que `--self-test` existe : sans lui, la seule panne que l'intégration
continue pourrait voir serait un registre illisible, et les dix conditions pourraient
pourrir sans que rien ne le dise.

Les formes sont désignées ici par leur drapeau et non par leur rang dans le tableau. Deux
renvois disaient « la quatrième » et « la cinquième » en pointant les cinquième et sixième
lignes, parce qu'une ligne avait été ajoutée sans que les renvois bougent.

---

## Les dix conditions, et ce que chaque refus veut dire

Aucune n'est un avertissement. Chacune décrit une chose qui, faite en vrai, coûte de
l'argent ou expose l'entreprise. La colonne **porte** dit, depuis le 5 septembre 2026,
laquelle des deux portes la porte : `argent` refuse, `publication` s'écrit dans
`docs/DETTE-LANCEMENT.md`.

| Condition | Porte | Refuse quand | Ce que ça coûterait |
|---|---|---|---|
| `registre` | publication | une ligne `bloquant` + `assumption` atteint un client, un fournisseur ou une presse | un chiffre inventé part en ligne sous le nom d'un prix |
| `tva` | publication | le régime n'est confirmé **dans aucun sens** | la boutique encaisse sans savoir ce qu'elle doit déclarer. Elle l'a déjà fait quinze fois |
| `mediation` | publication | aucun médiateur désigné **et** rien ne refuse un particulier | article L612-1 du code de la consommation. Les deux lignes prises séparément sont des refus assumés ; ensemble elles sont une infraction |
| `identite` | publication | une mention obligatoire manque à l'identité légale | article 6 III de la LCEN, et aucune pièce comptable conforme n'est possible |
| `editeur` | publication | l'hébergeur du site n'est pas nommé dans les mentions légales | article 6 III de la LCEN également. **Cette ligne manquait à ce tableau** : `Launch.php` l'émettait depuis la séance 13b, elle vaut quatre des vingt-sept refus d'aujourd'hui, et elle ne figurait ni dans l'auto-test ni dans la liste des conditions vérifiées |
| `cgv` | publication | une version en vigueur n'enregistre pas qui l'a relue ni quand | le contrat qui lie la boutique à ses clients est un brouillon interne |
| `textile-nu` | **argent** | un produit personnalisable est en vente sans textile nu déclaré | la boutique prend une commande dont elle ne peut acheter les vêtements |
| `prix-plancher` | **argent** | une colonne publiée vend sous son plancher de coût, ou personne ne l'a mesurée | la vente se fait à perte, et rien ne le montre avant la clôture comptable |
| `paiement` | **argent** | la passerelle de paiement n'est pas ce qu'elle annonce | l'argent n'arrive pas, ou arrive ailleurs, ou dans la mauvaise devise |
| `porte` | **argent** | la boutique n'a pas pu évaluer sa propre porte de l'argent | « on n'a pas pu regarder » n'est pas « tout va bien », et ici la différence est une caisse ouverte |
| `boutique` | les deux | on n'a pas pu interroger WordPress du tout | « on n'a pas pu regarder » n'est pas « il n'y a rien » |

**Fermé par défaut.** Un registre illisible, une boutique injoignable, un contrôle qui ne
tourne pas : tout cela refuse. C'est la règle de `CLAUDE.md` section 3 et elle n'a pas
d'exception ici.

---

## Les deux portes, depuis le 5 septembre 2026

Le portail refusait pour dix-huit raisons, dont treize lignes de registre que seul l'associé
peut trancher et deux conditions générales que seul un avocat peut lever. Un développeur
seul ne pouvait donc satisfaire aucune de ces quinze conditions, quel que soit son travail.
Un contrôle qu'on ne peut pas satisfaire n'est pas obéi, il est enjambé, et une porte qu'on
enjambe ne garde rien.

Les huit conditions ne changent pas. Elles sont réparties.

### `--porte=argent` : trois conditions dures, sans dérogation

```bash
node scripts/launch-gate.mjs --porte=argent --boutique=miroir
```

| Condition | Ce que ça coûte, cassée |
|---|---|
| un prix sous son plancher | la vente se fait à perte, et rien ne le montre avant la clôture comptable |
| un textile nu non déclaré sur un produit personnalisable **en vente** | la boutique encaisse une commande qu'elle ne peut pas acheter, après paiement |
| une passerelle de paiement mal configurée | l'argent n'arrive pas, ou arrive ailleurs, ou dans la mauvaise devise |

Le critère d'entrée dans cette liste est étroit, et il est écrit pour pouvoir être opposé à
une demande d'y ajouter une quatrième ligne : **une condition y figure si, cassée, elle fait
perdre de l'argent à l'entreprise ou trompe un acheteur sur un montant.** Pas si elle expose
juridiquement, pas si elle est embarrassante, pas si elle est urgente.

**Rien ne la neutralise.** `--porte=argent` combiné à `--ci` ou à `--depot` sort **2** et
refuse de tourner : le premier sort 0 par construction, le second n'interroge pas la
boutique, et une porte de l'argent qu'un drapeau désarme est une décoration.

**Elle exige que la boutique dise ce qu'elle a regardé.** Une liste de refus vide veut dire
deux choses opposées : « j'ai regardé, rien à signaler » et « cette version de l'extension
ne sait pas regarder ça ». Deux signaux sont acceptés, du plus fort au plus faible :

1. un champ `regarde` dans la réponse porcelaine, énumérant les conditions évaluées. C'est
   le seul qui permette à cette porte de dire **oui** sur une boutique sans reproche ;
2. à défaut, l'étiquette `porte` que `Launch::blockers()` pose sur chaque refus depuis le
   5 septembre 2026. Si tous les refus reçus la portent, l'extension est celle qui évalue
   les trois. Trou assumé de ce second signal : **zéro refus n'apprend rien**, donc une
   boutique irréprochable sort quand même 2 tant que le premier signal n'existe pas.

Tout le reste sort **2** : « on n'a pas pu regarder » n'est pas « il n'y a rien ».

### `--porte=publication` : sort 0, et écrit la dette

```bash
node scripts/launch-gate.mjs --porte=publication --boutique=miroir
```

Elle écrit `docs/DETTE-LANCEMENT.md` : chaque condition non tenue, datée, avec le nom de qui
peut la lever (**l'associé**, **le développeur**, ou **les deux**) et le geste précis qui la
lève. Elle ne recalcule rien : elle lit le même verdict que le portail complet, dans le même
ordre. Deux lectures divergeraient, et le jour où elles divergeraient le relevé dirait
« levé » sur une ligne que le portail refuse encore.

Le **régime de TVA** y part avec le développeur ET l'associé comme propriétaires. Il ne se
décide pas dans ce dépôt et il ne se coche pas dans `docs/hypotheses.json` : l'associé fait
trancher son comptable, le développeur écrit ensuite la période datée dans la boutique.
Aucun des deux ne peut finir seul.

Elle sort **0** sur une dette, et **2** si le relevé n'a pas pu être écrit : un relevé que
personne ne lira, c'est la situation qu'il remplace.

`TEESHOOP_DETTE=<chemin>` change la destination. Une exécution sans boutique (`--depot`)
produit un relevé où sept conditions sur dix sont « non regardées » : **l'écrire par-dessus
un relevé informé remplacerait une mesure par une absence de mesure**, dans un fichier suivi
par git. L'intégration continue écrit donc ailleurs.

### Ce que la décision coûte, et il faut le lire

La boutique peut être publiée en infraction à l'article L612-1 du code de la consommation,
avec des conditions générales qu'aucun juriste n'a relues et un régime de TVA que personne
n'a confirmé. Le portail le disait en refusant ; il le dit maintenant en l'écrivant. C'est un
choix, il est daté, et le relevé le nomme ligne par ligne.

## L'état mesuré, le 5 septembre 2026, sur le miroir

Le soir de la bascule en deux portes, contre le miroir docker, extension déployée et
répondant :

| | Portail complet | Porte de l'argent | Porte de publication |
|---|---|---|---|
| Commande | `--boutique=miroir` | `--porte=argent` | `--porte=publication` |
| Code de sortie | **1** | **1** | **0** |
| Raisons | **19** | **2** | 19 écrites |

Les 19 raisons du portail complet :

| Condition | Raisons | Porte |
|---|---|---|
| `registre` | 13 | publication |
| `cgv` | 2 | publication |
| `tva` | 1 | publication |
| `mediation` | 1 | publication |
| `textile-nu` | 1 | **argent** |
| `prix-plancher` | 1 | **argent** |

Le relevé de dette écrit par la porte de publication compte **19 lignes** : **13 pour
l'associé**, **4 pour les deux** (le régime de TVA, deux lignes de registre et la
médiation), **2 pour le développeur** (les deux refus d'argent).

**Le 23 du 2 septembre est devenu 19 par deux mouvements et une addition.** `textile-nu` est
passé de 6 à 1 quand la gamme a reçu ses références de textile nu les 4 et 5 septembre ; il
ne reste que « Tee de vérification » (#35), qui est une sonde. Et `prix-plancher` est une
condition NEUVE, du 5 septembre : personne n'a encore mesuré la grille publiée contre son
plancher de coût, et tant que la mesure n'existe pas la boutique ne peut pas dire qu'elle
vend au-dessus de ce qu'une commande lui coûte. Un refus de plus qui est un progrès : c'est
la première fois que quelqu'un pose la question.

**Le compte bouge quand la suite d'intégration tourne, et il bouge beaucoup.** Relevé
toutes les minutes pendant que `npm run test:wp` tournait, la nuit du 5 septembre :

```
19  registre 13, tva 1, mediation 1, cgv 2, textile-nu 1, prix-plancher 1   <- au repos
21  textile-nu 3                     (les deux montages de la suite sont publiés)
29  editeur 7, textile-nu 3, paiement 1   (la suite a remis à zéro l'identité du site)
22  editeur 0                        (elle la repose)
19                                   <- au repos, huit minutes plus tard
```

Un relevé de dette pris pendant une suite d'intégration nomme donc des produits qui
n'existeront plus et des mentions légales qui sont revenues toutes seules. **Le régénérer,
et regarder le miroir avant de conclure à une régression.** Le relevé le dit lui-même dans
son entête : c'est une photographie.

---

## L'état mesuré, le 2 septembre 2026

**REFUSÉE, 27 raisons**, réparties ainsi :

| Condition | Raisons |
|---|---|
| `registre` | 13 |
| `textile-nu` | 6 |
| `editeur` | 4 |
| `cgv` | 2 |
| `tva` | 1 |
| `mediation` | 1 |

Sept des treize lignes du registre sont les quatre tarifs de démonstration du studio, la
TVA et sa période, et le seuil de devis. Les six produits sans textile nu incluent trois
sondes de test ; les trois autres sont de vrais produits en vente.

**Ce nombre est stable depuis le 2 septembre 2026, et il ne l'était pas avant.** La suite
d'intégration publiait trois produits à chaque exécution sans jamais les effacer, donc le
verdict montait tout seul, de 7 refus à 19 en une après-midi. Le balayage de fin de suite les
retire maintenant et le vérifie. Si ce compte remonte sans qu'une décision ait été prise, la
première chose à regarder est le miroir et non la boutique.

**La treizième ligne est neuve et vient de la séance du 2 septembre :**
`H-Q63-FACTURE-EXTERNE`. Le site n'émet plus de facture depuis que la réponse à la question
24 est appliquée, et le système comptable qui doit en émettre n'est pas nommé. L'article 289
du code général des impôts en impose une à chaque acompte encaissé. Tant que personne ne
nomme ce système, encaisser un acompte est une obligation non remplie que rien ici ne peut
voir.

---

## L'état des VRAIES boutiques, mesuré le 2 septembre 2026

Rejoué depuis la séance 14, contre chacune des trois installations, avec la commande
au-dessus de chaque colonne. C'est la première fois que le portail a interrogé autre chose
que le miroir.

| | Miroir (docker) | Préproduction (WP Tiger) | Production (teeshoop.com) |
|---|---|---|---|
| Code de sortie | **1** | **1** | **2** |
| Boutique jointe | oui | oui | **non** |
| `registre` | 13 | 13 | 13 |
| `tva` | 1 | 1 | 1 |
| `mediation` | 1 | 1 | 1 |
| `editeur` | 0 | 0 | non regardé |
| `cgv` | 2 | 2 | non regardé |
| `textile-nu` | 6 | 0 | non regardé |
| `identite` | 0 | 0 | non regardé |
| **Total** | **23** | **17** | **16** |

**Ce tableau a bougé deux fois dans la journée du 2 septembre**, et les deux
mouvements se lisent :

- la préproduction est passée de 16 à 33 quand l'extension y a été déployée. Le 33
  n'était pas une régression : c'est le premier chiffre INFORMÉ, cinq conditions
  ayant enfin pu être regardées ;
- puis de 33 à 17 quand l'identité légale et celle de l'hébergeur y ont été
  posées. Les quatre champs de l'hébergeur ont été lus sur les conditions
  générales publiées par o2switch (`https://www.o2switch.fr/cgv/`), qui est la
  source que `ACCES-REQUIS.md` §6 quater désigne. Une recherche générale rendait
  deux SIRET différents ; c'est la page contractuelle qui tranche, et rien n'a été
  écrit avant de l'avoir lue.

Le miroir est passé de 27 à 23 par le même geste (`editeur` 4 puis 0). Il garde
ses 6 refus de `textile-nu` que la préproduction n'a pas, parce que ses produits
personnalisables sont ceux du catalogue importé.

**Le 16 des deux colonnes de droite n'est pas meilleur que le 27, il est moins informé.**
Quinze refus viennent du registre, qui est le même fichier pour les trois, et le seizième
est la condition `boutique` elle-même. La raison est la même des deux côtés et elle est
exacte :

```
Error: 'teeshoop' is not a registered wp command.
```

L'extension `teeshoop-core` **n'est déployée nulle part** : ni en préproduction, ni en
production. Cinq conditions sur huit ne peuvent donc pas être évaluées, et le portail sort
2 plutôt que 1 pour dire précisément cela. Ce sera le premier chiffre à rebaisser après le
premier déploiement en préproduction, et la séance 15 devra le comparer à celui-ci.

L'identité légale (`identite`, 0 refus sur le miroir) est le contre-exemple utile : elle
est renseignée sur le miroir et **sur le miroir seulement**. Sur la production, l'option
`teeshoop_legal` n'existe pas du tout. Le 0 de la colonne de gauche ne dit donc rien de
la boutique, et c'est la raison pour laquelle ces trois colonnes existent séparément.

---

## Séance 14 : déploiement

1. **Avant de déployer quoi que ce soit :** `npm run verify:lancement`. Un refus n'empêche
   pas de déployer en **préproduction**, qui est le but de la séance. Il empêche d'ouvrir
   la boutique au public.
2. Noter le nombre de raisons dans le compte rendu de séance, condition par condition. Il
   doit **baisser** entre 14 et 15, et si une nouvelle raison apparaît, c'est une régression
   et elle se traite avant le reste.
3. Les conditions `identite`, `cgv` et `textile-nu` interrogent la vraie boutique. Sur
   o2switch, elles répondront autre chose que sur le miroir. **Rejouer le portail contre la
   production est une étape de la séance 14, pas une formalité.**

   **Correction du 2 septembre 2026, mesurée en SSH.** Cette ligne annonçait « 462 produits
   publiés » en production. C'est faux : `wp post list --post_type=product --post_status=publish
   --format=count` sur teeshoop.com répond **47**. Le 462 est le nombre de références du
   catalogue importé sur le **miroir**, et il a été recopié ici comme s'il décrivait la
   boutique. La différence n'est pas cosmétique pour ce document : `textile-nu` parcourt
   chaque produit publié, donc le chiffre décide de la taille du refus qu'on attend.

## Séance 15 : répétition générale et mise en ligne

1. **La répétition générale ne compte pas si le portail n'a pas été rejoué juste avant.**
   Les conditions lisent l'état réel, et cet état bouge entre deux séances.
2. **La VENTE ne se fait pas sur un refus de la porte de l'argent.** Il n'y a pas de
   dérogation prévue et il ne faut pas en écrire une : les trois conditions de cette porte
   sont des faits vérifiables et aucune ne dépend d'un jugement. **La PUBLICATION, elle, se
   fait avec sa dette écrite**, depuis la décision du 5 septembre 2026 : c'est la seule
   phrase de ce document que cette décision a changée, et elle ne change rien à la
   précédente.
3. Si une condition doit être levée, elle se lève **en corrigeant ce qu'elle décrit**, et la
   trace de la correction est la nouvelle sortie du portail, collée dans le compte rendu.
   Pour une ligne de dette, la trace est le **diff de `docs/DETTE-LANCEMENT.md`**.

---

## Ce que le portail ne regarde pas

Il ne dit pas si le site est beau, rapide ou correct. Il ne remplace ni `npm run ci`, ni les
scripts de vérification, ni la passe adverse. Il répond à une seule question, celle que
personne n'avait su poser jusqu'à la séance 13b : **est-ce qu'il reste, dans cette boutique,
un chiffre que personne n'a confirmé et qu'un client va pourtant lire ?**
