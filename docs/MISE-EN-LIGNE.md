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

Elle sort **1** tant que la boutique ne doit pas être mise en ligne, et **0** quand elle
peut l'être. Il n'y a pas de troisième réponse et il n'y a pas de « oui mais ».

Trois formes, pour trois moments :

| Commande | Ce qu'elle demande | Qui s'en sert |
|---|---|---|
| `npm run verify:lancement` | « Peut-on lancer ? » Interroge le registre **et** la boutique | Séances 14 et 15 |
| `node scripts/launch-gate.mjs --depot --ci` | « Ce portail fonctionne-t-il ? » Le registre seul, sans WordPress | L'intégration continue |
| `node scripts/launch-gate.mjs --self-test` | « Ce portail sait-il encore refuser ? » | L'intégration continue |

La deuxième sort 0 même sur un refus, **par construction** : l'intégration continue n'a pas
de boutique à interroger et ne peut donc pas répondre à la première question. C'est
exactement pour cela que la troisième existe : sans elle, la seule panne que
l'intégration continue pourrait voir serait un registre illisible, et les sept conditions
pourraient pourrir sans que rien ne le dise.

---

## Les sept conditions, et ce que chaque refus veut dire

Aucune n'est un avertissement. Chacune décrit une chose qui, faite en vrai, coûte de
l'argent ou expose l'entreprise.

| Condition | Refuse quand | Ce que ça coûterait |
|---|---|---|
| `registre` | une ligne `bloquant` + `assumption` atteint un client, un fournisseur ou une presse | un chiffre inventé part en ligne sous le nom d'un prix |
| `tva` | le régime n'est confirmé **dans aucun sens** | la boutique encaisse sans savoir ce qu'elle doit déclarer. Elle l'a déjà fait quinze fois |
| `mediation` | aucun médiateur désigné **et** rien ne refuse un particulier | article L612-1 du code de la consommation. Les deux lignes prises séparément sont des refus assumés ; ensemble elles sont une infraction |
| `identite` | une mention obligatoire manque à l'identité légale | article 6 III de la LCEN, et aucune pièce comptable conforme n'est possible |
| `cgv` | une version en vigueur n'enregistre pas qui l'a relue ni quand | le contrat qui lie la boutique à ses clients est un brouillon interne |
| `textile-nu` | un produit personnalisable est en vente sans textile nu déclaré | la boutique prend une commande dont elle ne peut acheter les vêtements |
| `boutique` | on n'a pas pu interroger WordPress du tout | « on n'a pas pu regarder » n'est pas « il n'y a rien » |

**Fermé par défaut.** Un registre illisible, une boutique injoignable, un contrôle qui ne
tourne pas : tout cela refuse. C'est la règle de `CLAUDE.md` section 3 et elle n'a pas
d'exception ici.

---

## L'état mesuré, le 2 septembre 2026

**REFUSÉE, 28 raisons**, réparties ainsi :

| Condition | Raisons |
|---|---|
| `registre` | 13 |
| `textile-nu` | 7 |
| `editeur` | 4 |
| `cgv` | 2 |
| `tva` | 1 |
| `mediation` | 1 |

Sept des treize lignes du registre sont les quatre tarifs de démonstration du studio, la
TVA et sa période, et le seuil de devis. Les sept produits sans textile nu incluent trois
fixtures de test ; les quatre autres sont de vrais produits en vente.

**La treizième ligne est neuve et vient de la séance du 2 septembre :**
`H-Q63-FACTURE-EXTERNE`. Le site n'émet plus de facture depuis que la réponse à la question
24 est appliquée, et le système comptable qui doit en émettre n'est pas nommé. L'article 289
du code général des impôts en impose une à chaque acompte encaissé. Tant que personne ne
nomme ce système, encaisser un acompte est une obligation non remplie que rien ici ne peut
voir.

---

## Séance 14 : déploiement

1. **Avant de déployer quoi que ce soit :** `npm run verify:lancement`. Un refus n'empêche
   pas de déployer en **préproduction**, qui est le but de la séance. Il empêche d'ouvrir
   la boutique au public.
2. Noter le nombre de raisons dans le compte rendu de séance, condition par condition. Il
   doit **baisser** entre 14 et 15, et si une nouvelle raison apparaît, c'est une régression
   et elle se traite avant le reste.
3. Les conditions `identite`, `cgv` et `textile-nu` interrogent la vraie boutique. Sur
   o2switch, elles répondront autre chose que sur le miroir : la boutique de production a
   462 produits publiés, pas ceux du miroir. **Rejouer le portail contre la production est
   une étape de la séance 14, pas une formalité.**

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
