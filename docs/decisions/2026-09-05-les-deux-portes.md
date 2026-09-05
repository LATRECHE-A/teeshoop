# 5 septembre 2026 : le portail de mise en ligne devient deux portes

Décision du développeur, prise le 5 septembre 2026, transcrite par l'agent de la
nuit 4. Elle n'a pas été prise par un agent et elle n'est pas une interprétation :
elle est écrite ici parce qu'elle change le rôle d'un contrôle que trois documents
suivis par git décrivaient comme non contournable.

Chaque sortie citée plus bas a été produite en faisant tourner la chose réelle
contre le miroir docker, la nuit du 5 septembre 2026.

---

## 1. La décision, dans ses mots

Le développeur, en anglais, dans le brief de la nuit :

> « next time we'll push to production directly with no care of overthinking some
> legal shit, yes we must document everything missing, but don't overcomplicate
> things and just fucking push everything to production when you're done »

Elle est citée telle quelle parce qu'une reformulation l'adoucirait, et que
l'adoucissement est exactement ce qui se perdrait. Ce qu'elle demande, en clair :
publier sans attendre que la dette juridique soit épongée, et écrire cette dette
au lieu de s'en servir pour bloquer.

## 2. Ce qu'elle dit, et ce qu'elle ne dit pas

Elle dit : la publication ne s'arrête plus sur une relecture d'avocat manquante,
un médiateur non désigné ou une hypothèse de tarif que l'associé n'a pas encore
datée.

Elle ne dit pas : vendre à perte. Elle ne dit pas : encaisser sur une passerelle
mal réglée. Elle ne dit pas : prendre une commande qu'on ne peut pas acheter.

**Aucune dérogation n'a été écrite et il n'en faut pas.** `docs/MISE-EN-LIGNE.md`
disait déjà, avant cette décision, « il n'y a pas de dérogation prévue et il ne
faut pas en écrire une ». C'est toujours vrai. Ce qui change n'est pas la force
du contrôle, c'est son périmètre : il refusait tout, il refuse maintenant ce qui
coûte de l'argent, et il ÉCRIT le reste.

## 3. Pourquoi un portail unique ne tenait pas

Il refuse ce soir pour 19 raisons, dont 13 lignes de registre que seul l'associé
peut trancher, 2 conditions générales que seul un avocat peut lever, un régime de
TVA qu'un comptable doit confirmer et une médiation qui demande une adhésion. Un
développeur seul, la nuit, ne pouvait donc satisfaire aucune de ces 17 conditions,
quel que soit son travail. Un contrôle qu'on ne peut pas satisfaire n'est pas
obéi, il est enjambé, et une porte qu'on enjambe ne garde rien : le jour où elle
aurait refusé pour une bonne raison, la main serait déjà passée par-dessus par
habitude.

Les 2 qui restent sont exactement celles qu'un développeur PEUT lever, et ce sont
les deux que la porte de l'argent refuse.

C'est le raisonnement, et il est écrit ici pour qu'un désaccord porte sur lui et
non sur une découverte.

## 4. Les deux portes

```
node scripts/launch-gate.mjs --porte=argent
node scripts/launch-gate.mjs --porte=publication
```

**La porte de l'argent** porte trois conditions, et le critère d'entrée est
étroit, écrit pour pouvoir être opposé à une demande d'en ajouter une quatrième :
une condition y figure si, cassée, elle fait perdre de l'argent à l'entreprise ou
trompe un acheteur sur un montant.

| Condition | Ce que ça coûte, cassée |
|---|---|
| un prix sous son plancher | la vente se fait à perte, et rien ne le montre avant la clôture comptable |
| un textile nu non déclaré sur un produit personnalisable en vente | la boutique encaisse une commande qu'elle ne peut pas acheter, après paiement |
| une passerelle de paiement mal configurée | l'argent n'arrive pas, ou arrive ailleurs, ou dans la mauvaise devise |

**Elle peut toujours refuser, et rien ne la neutralise.** `--ci` sort 0 par
construction et `--depot` n'interroge pas la boutique : les deux sont refusés en
combinaison avec `--porte=argent`, avec la sortie 2, parce qu'une porte de
l'argent qu'un drapeau désarme est une décoration.

**La porte de publication** sort 0 et écrit `docs/DETTE-LANCEMENT.md` : chaque
condition non tenue, datée, avec le nom de qui peut la lever (l'associé, le
développeur, ou les deux) et le geste précis qui la lève. Elle ne recalcule rien :
elle lit le même verdict que le portail complet, dans le même ordre. Deux lectures
divergeraient, et le jour où elles divergeraient le relevé dirait « levé » sur une
ligne que le portail refuse encore.

Le régime de TVA part dans ce relevé avec **le développeur ET l'associé** comme
propriétaires. Il ne se décide pas dans ce dépôt et il ne se coche pas dans le
registre : l'associé fait trancher son comptable, le développeur écrit ensuite la
période datée dans la boutique. Aucun des deux ne peut finir seul.

## 5. Ce que la décision achète

- La mise en ligne cesse d'être suspendue à des réponses que personne ne peut
  donner cette nuit.
- La dette juridique cesse d'être un refus que personne ne lit : elle devient un
  fichier daté et nominatif, régénéré, dont le diff est la preuve qu'une ligne a
  été levée.
- Le contrôle qui reste est le seul qu'un développeur seul PEUT satisfaire, donc
  le seul qui a une chance d'être respecté.

## 6. Ce qu'elle coûte, et il faut l'écrire

- **La boutique peut être publiée en infraction à l'article L612-1 du code de la
  consommation** (aucun médiateur désigné et rien ne refuse un particulier), avec
  des conditions générales qu'aucun juriste n'a relues et un régime de TVA que
  personne n'a confirmé. Le portail le disait en refusant ; il le dit maintenant
  en l'écrivant. C'est un choix, pas un oubli, et le relevé de dette le nomme
  ligne par ligne.
- **Le relevé ne vaut que s'il est lu.** Il est écrit pour deux lecteurs qui ne
  lisent pas la même chose : le journal d'intégration continue, qui l'imprime, et
  l'administration WordPress, qui le rend. Tant qu'aucun des deux ne l'affiche,
  cette décision a remplacé un refus par un fichier.

## 7. La preuve, mesurée

`node scripts/launch-gate.mjs --self-test`, la nuit du 5 septembre 2026, tranche
14 cas de la porte de l'argent dans les deux sens :

```
  ARGENT OK   [sortie 1, attendu 1] un prix sous son plancher
  ARGENT OK   [sortie 1, attendu 1] un textile nu non déclaré sur un produit en vente
  ARGENT OK   [sortie 1, attendu 1] une passerelle de paiement mal configurée
  ARGENT OK   [sortie 2, attendu 2] la boutique ne dit rien et ne refuse rien : on ne sait pas si elle a regardé
  ARGENT OK   [sortie 2, attendu 2] la boutique n’a regardé que deux des trois
  ARGENT OK   [sortie 2, attendu 2] une extension d’avant le 5 septembre : des refus sans étiquette de porte
  ARGENT OK   [sortie 1, attendu 1] des refus tous étiquetés, dont un d’argent : elle a regardé, et elle refuse
  ARGENT OK   [sortie 0, attendu 0] des refus tous étiquetés, aucun d’argent : elle a regardé, et elle laisse passer
  ARGENT OK   [sortie 1, attendu 1] une clé neuve que ce script ne connaît pas, étiquetée argent par la boutique
  ARGENT OK   [sortie 1, attendu 1] une clé d’argent que la boutique étiquette « publication » : l’union refuse quand même
  ARGENT OK   [sortie 2, attendu 2] la boutique n’a pas répondu du tout
  ARGENT OK   [sortie 2, attendu 2] la boutique dit qu’elle n’a pas pu évaluer sa porte de l’argent
  ARGENT OK   [sortie 0, attendu 0] de la dette juridique seule : cgv, médiation, identité
  ARGENT OK   [sortie 0, attendu 0] rien du tout
```

Les trois `sortie 0` sont les plus importants des 14 : une porte qui refuserait
tout ne serait pas une porte, ce serait un mur, et personne ne remarquerait
jamais qu'elle a cessé de regarder. Celui qui laisse passer « de la dette
juridique seule » est la décision de cette note, rendue exécutable.

Et contre le miroir réel, la porte de l'argent, en retirant la référence de
textile nu du produit 169876 (sous verrou, puis remise) :

```
porte de l'argent : REFUS, 2 raison(s).                     <- avant
porte de l'argent : REFUS, 3 raison(s).                     <- cassé
  [textile-nu] « B&C #E150 T-Shirt à personnaliser » (#169876) est personnalisable
  et en vente, et ne déclare aucun textile nu
porte de l'argent : REFUS, 2 raison(s).                     <- remis droit
```

Ses deux refus réels, ce soir, sont « Tee de vérification » (#35) sans textile nu,
et la grille publiée que personne n'a mesurée contre son plancher de coût.

## 8. Comment la porte sait que la boutique a regardé

Elle exige que la boutique le DISE. Une liste de refus vide veut dire deux choses
opposées : « j'ai regardé, rien à signaler » et « cette version de l'extension ne
sait pas regarder ça ». Les confondre autoriserait à encaisser.

Deux signaux sont acceptés, du plus fort au plus faible :

1. un champ `regarde` dans la réponse porcelaine, énumérant les conditions
   évaluées. Il n'existe pas encore ;
2. à défaut, l'étiquette `porte` que `Launch::blockers()` pose sur chaque refus
   depuis cette nuit. Si tous les refus reçus la portent, l'extension est celle
   qui évalue les trois. C'est ce signal qui répond ce soir.

**Le trou du second signal est assumé et il est écrit ici pour être trouvé :**
zéro refus n'apprend rien, donc une boutique irréprochable sortira 2 tant que le
premier signal n'existe pas. Un refus sur une boutique propre est gênant ;
l'inverse serait d'autoriser un encaissement sur une version qui n'a rien regardé.
La ligne qui le comble est dans `Cli::launch()`, à côté de `blockers`.

Mesuré ce soir : tant que l'extension du miroir ne répondait pas (elle était en
cours d'écriture), la porte de l'argent sortait **2** avec « la boutique n'a pas
répondu », et non 0. C'est le comportement attendu, et c'est un refus, pas une
panne.

## 9. Les trois fois où ces portes ont été cassées exprès

`CLAUDE.md` interdit une porte qui ne peut pas échouer. Chaque contrôle ajouté
cette nuit a donc été cassé une fois, dans la transcription, puis remis droit.

1. **La porte de l'argent laisse passer un refus d'argent.** `porteArgent()` forcé
   à rendre 0. L'auto-test est passé à `ARGENT FAUX` sur les 6 cas qui attendaient
   un refus, et il est sorti **2**.
2. **Un poste de dette sans propriétaire nommé.** Le propriétaire des conditions
   générales mis à « personne ». `DETTE FAUX`, sortie **2**. La section de
   ramassage a bien attrapé la ligne, donc le compte de l'entête est resté juste :
   c'est ce pour quoi elle existe.
3. **L'entête annonce un compte que le corps ne porte pas.** Le compte de lignes
   augmenté de un à l'écriture. `RELEVÉ FAUX`, sortie **2**.

Et la porte de publication elle-même, avec sa destination rendue inaccessible :

```
launch-gate --porte=publication : le relevé de dette n'a pas pu être écrit dans
/proc/impossible/dette.md : ENOENT. Sortie 2 : publier en perdant la liste de ce
qui manque, c'est la situation que ce relevé remplace.
```
