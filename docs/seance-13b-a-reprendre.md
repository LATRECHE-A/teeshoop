# Séance 13b, ce qui reste à reprendre

> Écrit à la fermeture de la séance 13b (les réponses de l'associé), les 1er et
> 2 septembre 2026. Tout chiffre ici a été produit en faisant tourner la chose
> réelle. Ce qui n'a pas été mesuré le dit.

---

## 1. Le fait qui change la lecture de tout le reste

**La séance a été faite deux fois.** Le 1er septembre, les 61 réponses ont été
confrontées au registre, appliquées et commitées, et la séance s'est déclarée
finie sur une chaîne verte. Le 2 septembre, elle a été auditée contre son propre
brief plutôt que contre son propre compte rendu, et il manquait sept choses, dont
trois qu'un client aurait vues.

Ce n'est pas une anecdote, c'est la seule leçon de méthode de la séance :

- **Une chaîne verte ne dit pas qu'un travail est fini**, elle dit qu'aucun
  contrôle existant n'a échoué. Les trois défauts les plus graves du 1er septembre
  vivaient dans des endroits qu'aucun contrôle ne regardait.
- **Un compte rendu qui dit « fait » n'est pas une preuve.** La question 24 était
  écrite au présent (« le document cesse de s'appeler une facture ») et
  `Invoice.php` n'avait pas été touché par les vingt commits.
- **Les captures d'écran ne servent que si quelqu'un les lit.** Le
  « 0,00 € » du pied de page était lisible dans les captures prises une heure
  plus tôt.

---

## 2. Ce que le portail de mise en ligne refuse aujourd'hui

`npm run verify:lancement`, le 2 septembre 2026, sur le miroir : **REFUSÉE,
28 raisons.** La liste de contrôle des séances 14 et 15 est
`docs/MISE-EN-LIGNE.md`, et le portail tourne maintenant dans l'intégration
continue, ce qui n'était pas le cas quand il a été livré.

| Condition | Raisons | Ce qui la referme |
|---|---|---|
| `registre` | 13 | Les quatre tarifs du studio, la TVA et sa période, le seuil de devis en pièces, les zones d'impression, « imprimé en France », « pour les professionnels », les deux lignes des textes juridiques, et `H-Q63-FACTURE-EXTERNE` |
| `textile-nu` | 7 | Déclarer le textile nu de quatre produits en vente (trois des sept sont des fixtures de test) |
| `editeur` | 4 | Les quatre champs de l'hébergeur, à recopier du contrat o2switch |
| `cgv` | 2 | Un juriste qui relit et dont le nom et la date sont enregistrés (question 58) |
| `tva` | 1 | Une phrase du comptable, dans un sens ou dans l'autre (question 70 du registre, question 17 du document) |
| `mediation` | 1 | Désigner un médiateur **ou** fermer le parcours grand public (question 62) |

**Aucune de ces six n'est du code.** C'est le résultat que la séance visait :
tout ce qui pouvait être construit l'est, et ce qui reste est une décision, une
signature ou une saisie.

---

## 3. Les quatre formes qui ont changé, et les quatre qui ne sont pas construites

**Construites :**

1. **Le film s'achète à la feuille** (question 04). A3+ de 33 x 46 cm à
   3,00 EUR. Un tarif incohérent refuse au lieu de calculer.
2. **Le site n'émet plus de facture** (question 24). Récapitulatif de commande,
   référence TS2026-0001, et la première ligne des mentions dit où la facture est
   établie.
3. **Une quatrième mention de stock** (question 48), « Stock limité, nous
   consulter », sous un seuil dérivé du seuil de devis et non choisi.
4. **Le seuil de devis en euros porte sur la commande** (question 02) et non sur
   la ligne, ce que le mot « commande » de sa réponse dit.

**Pas construites, avec ce qui manque :** questions 37 (le coût doit suivre la
taille commandée : c'est le moteur de coût, et la remesure qui suit touche tous
les planchers), 44 (437 traductions de coloris à faire valider), 50 (la couture
de poche est indécidable à 14 mm près sur le maillage) et 54 (trois des quatre
critères de la remise par lot sont des jugements). Le détail est dans
`docs/ROADMAP.md`, section « Étiqueter, ou ne pas livrer ».

---

## 4. Ce que la séance 14 doit faire en premier

1. **`npm run verify:lancement` contre la vraie boutique**, pas contre le
   miroir. Trois des conditions interrogent WooCommerce, et la production a
   462 produits publiés qui ne sont pas ceux du miroir. Noter le nombre de
   raisons condition par condition : il doit baisser entre 14 et 15, et une
   raison neuve est une régression.
2. **Poser l'identité légale sur teeshoop.com.** Les treize champs sont dans
   `ACCES-REQUIS.md` §6 septies. Ils sont posés sur le miroir et nulle part
   ailleurs.
3. **Vérifier les trois boîtes aux lettres**, en une commande SSH, §6 septies.
4. **Poser la ligne de cron du rafraîchissement de stock**, et celle du balayage
   des créations le jour où il existe (question 33).

---

## 5. Ce qui est mesuré et ce qui ne l'est pas

**Mesuré le 2 septembre, en faisant tourner la chose :**

- La grille publique, par `tests/demo-grille.php` : **cinquante pièces sont
  passées sous leur plancher de 1,81 EUR**, et c'est la ligne que la page
  d'accueil met en avant. Le coût monte de 16 % à cent pièces malgré le temps de
  pose divisé par trois, parce que la feuille coûte plus cher que le rouleau pour
  ce visuel.
- Une commande réelle de trente t-shirts : vendue 326,10 EUR HT, coût connu
  240,19 EUR et incomplet, plancher 411,75 EUR, sous le plancher sans dérogation.
- Le groupage du textile, par `scripts/purchase-bench.mjs` : 278,05 EUR de
  vêtements et **48,00 EUR de port économisés** sur une semaine de six commandes,
  inchangé parce que la réponse à la question 03 ne donne aucun chiffre.
- Les treize pages publiques à 375, 768 et 1440 px : **296 assertions, 296
  passées**, et les captures 375 px sont dans `docs/screens/session13/`.
- Les quatre documents que la boutique enverrait, relus par un lecteur qui ne
  partage aucun code avec l'extension : **113 contrôles**, plus poppler.

**Pas mesuré, et il faut le savoir :**

- **`scripts/render-verify.mjs` ne va toujours pas au bout sur cette machine.**
  C'est le seul contrôle du dépôt qui REGARDE une image, et il est aveugle depuis
  le 26 août. La moitié est diagnostiquée (le canevas rend à la demande), l'autre
  non (un vêtement reste en « loading »). Aucune affirmation sur le rendu ne doit
  s'appuyer sur ce harnais tant que ce n'est pas fait.
- **Le marquage de la commande d'exemple est une borne haute**, parce que le
  service d'imbrication ne répond pas depuis le conteneur. Le coût réel est plus
  bas et le plancher aussi. Le rapport le dit lui-même.
- **Cinq des sept opérations d'atelier n'ont jamais été chronométrées**, et le
  coût de chaque commande se déclare `incomplet` plutôt que total.

---

## 6. Les deux questions neuves, et pourquoi elles bloquent

**62. Comment la boutique refuse-t-elle effectivement un particulier ?** Sans
réponse, l'exemption de médiation que sa réponse à la question 57 annonce ne
tient pas, parce qu'elle suppose un parcours qui refuse un consommateur et que
rien ne le fait. Trois issues, chiffrées, sous la question.

**63. Quel système émet vos factures légales, et qui émet celle d'un acompte ?**
Née de l'application de la question 24, le 2 septembre. L'article 289 du code
général des impôts impose une facture à chaque acompte encaissé, la boutique n'en
produit plus, et le système qui doit le faire n'est pas nommé. C'est le seul
endroit où cette séance a rendu la boutique **plus prudente qu'elle ne l'était la
veille**, et c'est délibéré : sa réponse a retiré une facture, et tant que
personne ne dit ce qui la remplace, la bonne réponse est de ne pas encaisser.
