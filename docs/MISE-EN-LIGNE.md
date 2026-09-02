# Mise en ligne : ce que les séances 14 et 15 doivent lire

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

Cinq formes, pour cinq moments :

| Commande | Ce qu'elle demande | Qui s'en sert |
|---|---|---|
| `npm run verify:lancement` | « Peut-on lancer ? » Le registre **et** le miroir local | Le développeur |
| `node scripts/launch-gate.mjs --boutique=ssh:teeshoop:~/public_html` | La même question, posée à **la vraie boutique**, avec une clé qui peut lancer wp-cli | Le développeur |
| `node scripts/launch-gate.mjs --boutique=deploy:teeshoop:prod` | La même question, par le verbe `verdict` de `deploiement.sh` | **Le déploiement**, dont la clé restreinte ne peut lancer que ça |
| `node scripts/launch-gate.mjs --json --boutique=…` | La même chose, lisible par un programme | Le déploiement, qui archive le verdict |
| `node scripts/launch-gate.mjs --depot --ci` | « Ce portail fonctionne-t-il ? » Le registre seul, sans WordPress | L'intégration continue |
| `node scripts/launch-gate.mjs --self-test` | « Ce portail sait-il encore refuser ? » | L'intégration continue |

**La deuxième n'existait pas avant la séance 14**, et son absence était un trou : trois
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

La quatrième sort 0 même sur un refus, **par construction** : l'intégration continue n'a pas
de boutique à interroger et ne peut donc pas répondre à la première question. C'est
exactement pour cela que la cinquième existe : sans elle, la seule panne que
l'intégration continue pourrait voir serait un registre illisible, et les huit conditions
pourraient pourrir sans que rien ne le dise.

---

## Les huit conditions, et ce que chaque refus veut dire

Aucune n'est un avertissement. Chacune décrit une chose qui, faite en vrai, coûte de
l'argent ou expose l'entreprise.

| Condition | Refuse quand | Ce que ça coûterait |
|---|---|---|
| `registre` | une ligne `bloquant` + `assumption` atteint un client, un fournisseur ou une presse | un chiffre inventé part en ligne sous le nom d'un prix |
| `tva` | le régime n'est confirmé **dans aucun sens** | la boutique encaisse sans savoir ce qu'elle doit déclarer. Elle l'a déjà fait quinze fois |
| `mediation` | aucun médiateur désigné **et** rien ne refuse un particulier | article L612-1 du code de la consommation. Les deux lignes prises séparément sont des refus assumés ; ensemble elles sont une infraction |
| `identite` | une mention obligatoire manque à l'identité légale | article 6 III de la LCEN, et aucune pièce comptable conforme n'est possible |
| `editeur` | l'hébergeur du site n'est pas nommé dans les mentions légales | article 6 III de la LCEN également. **Cette ligne manquait à ce tableau** : `Launch.php` l'émettait depuis la séance 13b, elle vaut quatre des vingt-sept refus d'aujourd'hui, et elle ne figurait ni dans l'auto-test ni dans la liste des conditions vérifiées |
| `cgv` | une version en vigueur n'enregistre pas qui l'a relue ni quand | le contrat qui lie la boutique à ses clients est un brouillon interne |
| `textile-nu` | un produit personnalisable est en vente sans textile nu déclaré | la boutique prend une commande dont elle ne peut acheter les vêtements |
| `boutique` | on n'a pas pu interroger WordPress du tout | « on n'a pas pu regarder » n'est pas « il n'y a rien » |

**Fermé par défaut.** Un registre illisible, une boutique injoignable, un contrôle qui ne
tourne pas : tout cela refuse. C'est la règle de `CLAUDE.md` section 3 et elle n'a pas
d'exception ici.

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
2. **La mise en ligne ne se fait pas sur un refus.** Il n'y a pas de dérogation prévue et
   il ne faut pas en écrire une : les sept conditions sont toutes des faits vérifiables et
   aucune ne dépend d'un jugement.
3. Si une condition doit être levée, elle se lève **en corrigeant ce qu'elle décrit**, et la
   trace de la correction est la nouvelle sortie du portail, collée dans le compte rendu.

---

## Ce que le portail ne regarde pas

Il ne dit pas si le site est beau, rapide ou correct. Il ne remplace ni `npm run ci`, ni les
scripts de vérification, ni la passe adverse. Il répond à une seule question, celle que
personne n'avait su poser jusqu'à la séance 13b : **est-ce qu'il reste, dans cette boutique,
un chiffre que personne n'a confirmé et qu'un client va pourtant lire ?**
