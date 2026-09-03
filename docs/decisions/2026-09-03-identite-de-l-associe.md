# 3 septembre 2026 : l'identité de l'associé, appliquée, et les trois arbitrages qu'elle a demandés

**Contexte.** Le développeur a ouvert la préproduction le 2 septembre et l'a trouvée
inacceptable : zéro `<img>` sur l'accueil contre 51 en production, un bleu inventé
(`#1f4fd8`) et une police inventée (Inter) sur un site dont le propriétaire avait demandé
par écrit de garder les siennes. La réponse 31 de l'associé, datée du 1er septembre
(`docs/reponses-associe/reponses-q01-q36.txt`, lignes 241 à 245) :

> « L'identité existe déjà. Il faut conserver le logo actuel, les couleurs actuelles, les
> typographies actuelles, le menu et l'organisation déjà définis (...) Il ne faut pas
> repartir du design de démonstration du thème, ni recréer une nouvelle identité visuelle
> sans nécessité. »

`tokens.css` portait encore « QUESTION 31 IS NOT ANSWERED » en en-tête, daté du 20 août.

Personne n'était joignable cette nuit-là. Les trois arbitrages ci-dessous ont donc été
pris seuls, et ils sont écrits ici pour qu'un désaccord porte sur la décision et pas sur
une découverte.

---

## 1. Le recensement de pixels du logo ne donne pas les mêmes nombres que le brief

Le brief de la séance annonçait 1 710 pixels de navy et 1 347 d'orange. Mesuré ce soir sur
le fichier public
`https://www.teeshoop.com/wp-content/uploads/2025/05/Sans-titre-300-x-54-px.png`, avec deux
programmes indépendants :

| | pngjs, alpha >= 250 | ImageMagick, alpha aplati |
|---|---|---|
| `#010050` | 2 225 px | 2 380 px |
| `#FF8601` | 1 455 px | 1 488 px |

**Les deux hexadécimaux sont confirmés deux fois ; les comptages ne le sont pas.** L'écart
vient du seuil d'opacité : 11 951 des 16 200 pixels de ce logo sont transparents ou
partiels, et le rang de chaque couleur dépend donc entièrement de l'endroit où on coupe.
Ce qui compte pour une palette est la valeur, pas le comptage, et la valeur est la même
dans les quatre mesures.

**Décision : on retient `#010050` et `#FF8601`, et on écrit nos propres comptages plutôt
que ceux du brief.** Un nombre qu'on n'a pas produit soi-même n'a pas sa place dans un
commentaire qui prétend être une mesure.

## 2. La police de texte : Lato ou Work Sans

Le site en ligne charge **trois** familles depuis Google :
`Work Sans:400,600 | Urbanist:400,600,700,800 | Lato:400,700`.

- Urbanist est `--wd-entities-title-font` à 700 et `--wd-header-el-font` à 600. C'est la
  police des titres et de la navigation, sans ambiguïté.
- Le texte courant, lui, est dit deux fois : `--wd-text-font` vaut **Work Sans** et
  `--wd-alternative-font` vaut **Lato**.

**Décision : Lato.** Trois raisons, dans cet ordre.

1. Lato est une des trois familles que la boutique sert déjà : ce n'est pas une invention,
   c'est bien « une typographie actuelle ».
2. Une troisième famille, ce sont des octets sur chaque page d'une boutique hébergée en
   mutualisé. Les quatre fichiers livrés pèsent 70 764 octets mesurés ; une famille de plus
   en ajouterait environ 45 000.
3. Le brief de la séance nomme explicitement Urbanist et Lato, en donnant la variable
   source de chacune. Ignorer une instruction écrite au profit d'une lecture personnelle
   demande une meilleure raison que « l'autre variable existe aussi ».

**Ce que cette décision coûte, dit franchement :** le texte courant du site rendu par notre
thème n'est pas dans la même police que le texte courant de teeshoop.com aujourd'hui. Les
deux sont des linéales humanistes très proches à 15 px, mais ce n'est pas identique. **La
question part à l'associé** (QUESTIONS-ASSOCIE.md) et le changement, s'il la tranche dans
l'autre sens, tient en deux lignes de `tokens.css` et deux fichiers `.woff2`.

## 3. Une couleur de marque qui échoue au contraste n'est pas remplacée

Deux des trois couleurs relevées ne peuvent pas porter de texte sur blanc :

| Couleur | Sur blanc | Verdict |
|---|---|---|
| `#010050` navy | 18,80:1 | porte tout |
| `#FF8601` orange du logo | **2,42:1** | échoue même le 3:1 d'un bord de contrôle |
| `#F59A57` `--wd-primary-color` | **2,18:1** | pire |

**Décision : on ne change pas la couleur, on décide où elle a le droit d'être posée.**
L'orange est un **aplat** et jamais une marque sur papier : pas de texte dedans, pas de
filet, pas d'icône à trouver. Là où il est chez lui, il est excellent : 7,75:1 sur le navy,
et 6,40:1 sous le texte d'encre, ce qui est exactement l'usage qu'en fait le logo.

Pour les cas où l'orange doit quand même être une marque sur blanc (un prix, un
soulignement), une variante est **dérivée** en gardant la teinte (31,4°) et la saturation
(100 %) et en descendant la seule luminosité, de 50,2 % à 35,6 % : `#B65F00`, 4,54:1.
**Les deux nombres sont inscrits dans `tokens.css`**, celui qui échoue comme celui qui
passe, pour que personne ne re-tente le premier.

Même traitement pour `--wd-text-color` `#767676`, qui est 4,54:1 sur blanc (il passe, de
quatre centièmes) et 4,24:1 sur notre teinte de surface (il échoue). Aucune teinte
utilisable ne le sauve : il faudrait un fond de luminance 0,990, et `#f6f7f9` est à 0,930.
La couleur reste donc, **bornée au papier**, et `--ts-muted-strong` `#717171` prend le
relais sur les fonds teintés. `scripts/palette-guard.mjs` suit maintenant les deux rôles
séparément et chaque consommateur déclare lequel il dessine.

---

## Ce qui a changé de nom, et pourquoi ce n'est pas cosmétique

`--ts-on-ink-muted` et `--ts-on-ink-warn` sont devenus `--ts-on-brand-*`. Le pied de page
était peint en `--ts-ink` ; il est maintenant peint en navy. Un jeton dont le nom dit
contre quel fond il a été mesuré, pointant vers un autre fond, est la façon dont un défaut
de contraste survit à une refonte.

`--ts-accent`, en revanche, **garde son nom** tout en changeant de valeur. Trente-quatre
règles, le `$blue` du composeur de courriels, le `--accent` de la page de BAT et le garde
qui compare les trois veulent déjà dire « la couleur de marque qui porte du texte blanc »
par ce nom. Le renommer aurait été une centaine de lignes de diff dans quatre fichiers la
nuit où la valeur changeait, ce qui est la manière habituelle de laisser une couleur à
moitié migrée. `$blue` reste d'ailleurs honnête : `#010050` est un hsl(240,8°).

`--ts-radius-lg` a été supprimé : aucune règle du dépôt ne le lisait.
