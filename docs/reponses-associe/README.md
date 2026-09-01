# Les réponses de l'associé, vendorées telles quelles

Deux documents, reçus le 1er septembre 2026, qui répondent aux 61 questions de
[`QUESTIONS-ASSOCIE.md`](../../QUESTIONS-ASSOCIE.md). Ils sont ici pour la même raison que
`docs/bible/` : pour qu'on puisse les **citer** et les `grep`, et pour qu'une réponse
recopiée ailleurs puisse toujours être confrontée à son original.

| Fichier | Couvre | Daté par son auteur | Reçu |
|---|---|---|---|
| `reponses-q01-q36.pdf` (`.txt`) | questions 1 à 36 | 19 août 2026 | 1er septembre 2026 |
| `reponses-q37-q61.pdf` (`.txt`) | questions 37 à 61 | 1er septembre 2026 | 1er septembre 2026 |

Les `.txt` sont l'extraction de `pdftotext -layout`, faite une fois, sans retouche. Ils
existent parce qu'un PDF n'est pas `grep`-able et qu'une réponse qu'on ne peut pas citer
au caractère près est une réponse qu'on finit par paraphraser.

Empreintes des sources, pour qu'un remplacement silencieux se voie :

```
fd46054d1de7af068f298a3df3e8d7cb  reponses-q01-q36.pdf
e0a0aeac92da85cb170052fa286bb9bf  reponses-q37-q61.pdf
```

## Ce qui prime sur quoi

Le second document le dit lui-même, en première page et en conclusion :

> En cas de contradiction avec une hypothèse antérieure, les décisions ci-dessous
> prévalent.

Il ne parle que de Q37 à Q61. Là où les deux documents se croisent sur un même fait, c'est
le plus récent qui tranche, et il y a au moins un cas : l'adresse. Le document du 19 août
donne le **siège** (97 avenue de Castelnau, 93700 Drancy, question 17) et celui du
1er septembre donne une adresse d'**établissement** pour la fiche Google
(8 rue Primo Lévi, 93000 Bobigny, question 55). Ce ne sont pas la même chose et ce n'est
pas forcément une contradiction, mais les mentions légales n'en publient qu'une : la
question est reposée à l'associé, elle n'est pas tranchée ici.

## Ce que ce dossier n'est pas

Ce n'est **pas** le registre. Le registre exécutable est `docs/hypotheses.json`, et c'est
la séance 13b qui confronte chaque réponse à sa ligne, ligne par ligne, avant de changer
quoi que ce soit. Ici, rien n'est interprété : ce sont les mots de l'associé, et la
transcription lisible est dans `QUESTIONS-ASSOCIE.md`, sous chaque question, avec sa date
et son document d'origine.

## Une réserve sur le tiret long

`CLAUDE.md` interdit le tiret cadratin dans tout ce que ce projet écrit, et
`scripts/style-guard.mjs` l'applique. Ce répertoire est **exclu du contrôle**, exactement
comme `docs/bible/`, parce que ce sont les mots de l'associé et qu'on ne les corrige pas.
Le caractère apparaît deux fois, aux lignes 143 et 144 de `reponses-q37-q61.txt`, dans les
exemples de la question 44 (« Bleu marine — Navy »). Le séparateur qui finira à l'écran est
une décision d'interface, pas une décision de l'associé.
