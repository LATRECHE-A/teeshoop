# 5 septembre 2026 : le plancher devient la marge brute de 50 % que l'associé a répondue

Décision prise seule, la nuit. Elle remplace le niveau choisi la veille
(`2026-09-04-le-tarif-derive-du-plancher.md`), qui reste valable pour tout le
reste : la méthode, le garde, et la façon de refaire la mesure.

Tous les chiffres viennent de commandes dont la sortie est dans la transcription
de la séance : `npm run verify:grille`, `npm run test:wp`, et le moteur de coût
lancé sur les neuf références réelles de la gamme.

---

## 1. Ce que la veille avait laissé ouvert

Le 4 septembre, le tarif a été remonté au plancher de **contribution** : 25 % du
prix conservés après commission, ce qui donnait 23,00 EUR le t-shirt à cinq
pièces. Trois cibles avaient été calculées, et la note disait explicitement que
le choix entre elles appartenait à l'associé (question 64).

Il avait déjà répondu. Réponse à la question 06, reçue le 1er septembre :

> « un objectif de marge brute minimale d'environ 50 % après coûts directs »

Ce n'était pas une cible parmi d'autres. C'est le mot **minimale**, et la phrase
qui suit dans sa réponse nomme le plancher. Ne pas l'appliquer, c'était publier
un tarif sous le minimum écrit par la personne à qui appartient la décision, en
attendant une réponse qu'elle avait déjà donnée.

## 2. Les deux jambes du plancher, et pourquoi elles ne mesurent pas la même chose

`Margin::floor_price` prend maintenant le plus haut de deux nombres :

- **la contribution**, 25 % du prix conservés APRÈS la commission du commercial.
  Elle protège la trésorerie sur une vente commissionnée.
- **la marge brute**, 50 % du prix au-dessus des coûts directs. Elle protège la
  rentabilité de l'entreprise, commission ou pas.

La contribution ne reprend la tête qu'au-dessus de 50 % de commission, parce que
`1 - 0,25/(1-c) < 0,5` demande `c > 0,5`. Dans la configuration livrée, c'est
donc toujours la marge brute qui tient le plancher, et le rapport de coût le dit
en toutes lettres (`floor_basis` rend « marge_brute »).

**Ce que l'ancien tarif dégageait vraiment**, mesuré colonne par colonne : entre
26,1 % et 41,1 % de marge brute, médiane 32 %. Il était sous son minimum partout,
y compris là où il couvrait le coût.

## 3. Le tarif que cela produit

Même règle que la veille, seul le plancher a changé : le plus petit tarif auquel
aucune colonne publiée ne passe sous son plancher, au coloris et à la taille les
plus chers, arrondi à l'euro supérieur. Solution exacte 33,69 EUR et 72,44 EUR.

| | 4 septembre | 5 septembre |
|---|---|---|
| T-shirt, base HT | 13,00 EUR | **24,00 EUR** |
| Sweat, base HT | 39,00 EUR | **63,00 EUR** |
| Première face | 10,00 EUR | 10,00 EUR |
| T-shirt une face, 5 pièces | 23,00 EUR | **34,00 EUR** |
| T-shirt une face, 50 pièces | 14,95 EUR | **22,10 EUR** |
| Sweat une face, 5 pièces | 49,00 EUR | **73,00 EUR** |
| Marge la plus tendue au-dessus du plancher | 16,17 EUR | **5,08 EUR** (t-shirt), 10,73 EUR (sweat) |
| Colonnes publiées sous leur plancher | 0 sur 111 | **0 sur 99** |

## 4. Trois conséquences, aucune n'est un défaut

**Le passage en devis arrive plus tôt.** Le seuil d'autonomie de 2 000 EUR HT
est la règle de l'associé (réponse 02, et le commentaire de `Pricing.php` qui
disait le contraire a été corrigé : il avait été écrit avant les réponses et
jamais relu après). Au nouveau tarif, cent t-shirts valent 2 210 EUR HT et
cinquante sweats dépassent aussi. Ces colonnes ne portent plus de prix public.
C'est sa règle appliquée à sa marge. La grille et le panier disent la même chose,
et une assertion d'intégration compare désormais les deux verdicts dans les deux
sens, parce que c'est exactement l'endroit où ils peuvent se contredire sans
que personne ne le voie.

**Le tarif est au-dessus du marché relevé.** mistertee vend le même genre de
t-shirt imprimé à l'unité entre 15,97 et 23,11 EUR, et son propre moteur de prix
calcule 19,26 EUR. À 34,00 EUR, nous sommes dehors. C'est la conséquence directe
de sa réponse, appliquée telle quelle, et elle lui est présentée chiffrée
(question 64 réécrite) plutôt qu'atténuée par nous. Descendre sous son minimum
écrit n'est pas une décision d'ingénierie.

**Une règle de périmètre ne pouvait plus rien baisser.** `PriceRule` ne savait
scoper que la contribution, c'est-à-dire la jambe muette : une règle « t-shirts
en volume » à 15 % de contribution ne déplaçait plus aucun plancher. Un test
d'intégration l'a montré en refusant de voir bouger le sien, et il avait raison.
`PriceRule` scope maintenant les trois taux, l'écran propose le troisième, et le
rapport gèle celui que la règle portait. Mesuré : plancher 234,12 EUR sans règle,
234,12 EUR avec la contribution seule amincie, 167,23 EUR quand la règle amincit
la jambe qui tient.

## 5. Comment refaire la mesure

```
npm run wp:up
npx wrangler dev --port 8788 --ip 0.0.0.0
npm run wp:cli -- eval 'update_option("teeshoop_settings", array_merge((array) get_option("teeshoop_settings"), ["worker_url" => "http://host.docker.internal:8788"]));'
npm run verify:grille
```

Le garde a été cassé volontairement deux fois pour prouver qu'il sait refuser :
en abaissant `base_ht` de 13,00 à 6,00 (code 1, 80 refus nommés), et en rendant
toutes les tailles non imprimables (code 1, neuf références nommées). Il rend
99 colonnes vertes une fois remis en état.
