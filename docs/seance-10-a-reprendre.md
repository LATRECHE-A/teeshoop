# Séance 10, ce qu'il reste à mesurer et comment le relancer

Écrit le 25/08/2026 à 17 h, quand la machine a été arrêtée en cours de balayage. Ce
document existe pour qu'une reprise n'ait pas à redécouvrir l'état : il dit ce qui est
mesuré, ce qui ne l'est pas, pourquoi, et la commande exacte pour finir.

Le récit de ce que la séance a corrigé est dans `docs/ROADMAP.md`. Ici il n'y a que
l'état d'avancement et les recettes.

---

## 1. Pourquoi la machine a été arrêtée

Les contrôles 3D rendent dans un navigateur sans carte graphique : chromium rastérise en
logiciel, sur le processeur. Une image de 1 200 x 1 500 d'un maillage de 235 000 triangles
avec ombres VSM, carte d'environnement cuite et lobe de duvet coûte des SECONDES, pas des
millisecondes, et chaque contrôle en prend plusieurs par cas.

Mesuré pendant la séance : un mockup toutes les **6,4 minutes**, et jusqu'à **8 à 9 minutes**
par prise sur le sweat (811 000 triangles). Charge moyenne montée à **10,8**, dont une part
tient au miroir WordPress docker (`wp-local-db-1`) dont la sonde de santé MySQL occupe un
cœur en continu. À l'arrêt : **1,6 Gio de swap sur 2,0 Gio** occupés pour 7,7 Gio de RAM.

C'est la cause probable des `SIGSEGV` sur les autres sessions : il n'y avait plus de mémoire
à donner à un nouveau processus.

**Avant de relancer un balayage : `npm run wp:down`**, et le remettre après avec
`npm run wp:up`. Et ne pas lancer d'agents de lecture en parallèle d'un contrôle qui mesure
un temps (voir 3.2).

---

## 2. Ce qui EST mesuré sur l'arbre livré (commit 0193a92)

| contrôle | verdict | ce qu'il dit |
|---|---|---|
| `npm run ci` | **vert** | 489 tests PHP, 168 tests unitaires, tous les gardes propres |
| `npm run verify:bundle` | **vert** | 39 fichiers, 0 marqueur interdit sur 23 aiguilles |
| `scripts/fabric-verify.mjs` | **PASS** | la table d'arc, la girth physique, la vérité d'arc, les zones, la grille AR |
| `scripts/backreg-verify.mjs` | **PASS** | 44 contrôles, le panneau arrière reste calé sur l'avant et refuse ce qu'il ne peut pas caler |
| `scripts/ar-verify.mjs` | **PASS** | 8 cuissons GLB/USDZ valides et sûres pour Scene Viewer |
| `scripts/parity-verify.mjs` | **PASS** | le placement d'impression concorde entre 2D, 3D et AR à 0,0-0,5 % près sur les trois tailles |
| `scripts/grading-verify.mjs` | **PASS** | la déclinaison par taille tient à 0,27 %, et le raster du transfert colle à la zone au pixel |
| `scripts/board-verify.mjs` | **PASS** | sans le moindre avertissement, alors qu'il sortait en WARN avant la séance |
| `npm run verify:leak` | **PASS** | nouveau : parcourir les scènes n'alloue plus rien (13 textures, plates sur 18 changements, contre 13 -> 67 avant), les six scènes éclairent toujours différemment, et la sortie d'échec est prouvée (`rc=3` sur l'arbre cassé exprès) |
| `scripts/3d-shots.mjs` | 14 images sur 14 **distinctes** | et 14 sur 14 sur l'arbre d'AVANT la séance aussi, une fois le script corrigé : les doublons venaient de l'instrument, pas du studio (voir 3.5) |
| `scripts/frame-bench.mjs` | mesuré | voir `.qa/frame-bench-after2.json` et l'en-tête de `src/three/index.tsx` |

Construction, contre l'arbre d'avant la séance (`1935798~1`, worktree) :

```
première peinture   App-*.js      170,91  ->  170,93 kB   (+0,02)
morceau 3D paresseux three-*.js  1 133,25 -> 1 132,57 kB   (-0,68)
total JS                          2 469,28 -> 2 475,91 kB  (+6,63, entièrement en morceaux paresseux)
```

**Re-mesuré sur `d0a8835`, c'est-à-dire après la correction de la fuite**, parce que ces
nombres-là dataient de `0193a92` et que `src/three/` a bougé deux fois depuis :

```
première peinture   App-*.js       170,93 kB    identique
morceau 3D paresseux three-*.js  1 132,58 kB    identique
total JS                          2 476,80 kB   +0,89 contre 2 475,91
```

Les 0,89 kB sont dans `Stage-*.js`, qui est paresseux : la fuite se corrige sans rien coûter
à la première peinture. Le recensement `window.__stage.census()` n'y est pas, il est derrière
`import.meta.env.DEV`.

---

## 3. Ce qui n'est PAS mesuré, et pourquoi

### 3.1 `npm run verify:render` : LANCÉ, 73 verts et 1 rouge

**Balayage complet du 26/08/2026, `.qa/render-s2`, 15 prises, 2 h 20, sortie 3.** Le
déterminisme est réglé (216,07 contre 216,07, écart 0,00, contre 216 puis 212). Il reste un
rouge, `tee-black-night`, qui se détache de son fond de 7,7 niveaux pour 8 exigés ; seul il
en fait 10,8, et les deux valeurs sont stables à la décimale à travers deux séances. Le récit
est dans `docs/ROADMAP.md`.

Ce qui suit décrivait l'état d'avant.

**N'avait jamais été lancé en entier sur cet arbre.** Le dernier balayage complet date de deux commits
avant la correction du duvet du sweat, de la sonde de vue et du hissage de `vInkAlpha`.

Huit des quatorze cas portent une information que rien n'a mesurée depuis :
`hoodie-black-34` et `hoodie-black-print` (le duvet ramené à 0,45 / 0,95),
`tee-white-print` et `tee-black-print` (le nuanceur d'encre modifié),
`tee-white-front` (le chemin de vue corrigé), plus les trois cas neufs
`tee-black-forest`, `tee-black-city` et `custom-34`.

Coût : environ **9 minutes par cas**, soit un peu plus de deux heures.

```
npm run wp:down
node scripts/render-verify.mjs .qa/render-s2
npm run wp:up
```

Deux assertions étaient rouges au dernier balayage complet et le sont probablement encore :
l'écart de 2 % d'une image prise tard dans un balayage.

**`RENDER_DOUBLE=1` a tourné le 25/08/2026 et a tranché.** Sur `tee-white-34` et
`tee-black-night`, 31 minutes, trois prises : les trois relectures d'une image inchangée sont
**identiques**, l'écart de déterminisme est **0,00** (contre 216 puis 212 sur le balayage
complet) et `tee-black-night` lit **27**, sa valeur « seul ». Verdict PASS, sortie 0.

Donc le tampon de dessin n'est pas en cause : c'est de l'état qui survit d'un cas au suivant.
Reste à savoir lequel. Les trois prises du balayage court montaient le même vêtement ; tous
les cas qui ont dérivé avaient un autre GLB monté entre-temps. **Sonde suivante, quelques
secondes** : relever `renderer.info.memory` et `renderer.info.render` de part et d'autre d'un
`setGarment`, et voir si les compteurs montent.

### 3.2 `scripts/inflate-verify.mjs` : RÉSOLU, c'était la machine

**Relancé au calme le 25/08/2026 : PASS, sortie 0, 19 minutes.** Le contrôle le plus lent
construit sa coque en **748 ms** pour un budget de 900, et la construction à froid la plus
lente tient en 979 ms. Rien à corriger, et le budget n'a pas bougé d'une milliseconde.

Les deux mesures côte à côte, qui sont tout l'intérêt de l'exercice :

| charge moyenne | cas au-dessus de 900 ms | pire temps |
|---|---|---|
| 10,8 (balayage + agents) | 7 | 2 136 ms |
| ~10 au départ, 6,6 à l'arrivée, rien d'autre que le terminal | **0** | **748 ms** |

Ce qui suit décrit l'état d'avant et se garde parce que c'est la raison pour laquelle on
n'a pas touché au budget.

**Échouait sur une assertion de temps, deux fois, et la machine était chargée les deux fois.**

- 1 cas au-dessus du budget de 900 ms (1 358 ms) pendant que huit agents de lecture
  tournaient ;
- 7 cas au-dessus (914 à 2 136 ms) à charge moyenne 10,8.

Son propre en-tête dit que le même cas se construit en **216 ms machine libre** et a été
chronométré à **1 251 ms avec trois autres processus en concurrence**. Le chemin de code
qu'il mesure (`src/lib/ingest`) n'a pas été touché de la séance. Tout le reste du contrôle
(invariants du creux, déterminisme, portail vêtement / pas-vêtement) passe.

**Ne pas remonter le budget.** Un budget qui bouge pour s'adapter à la machine n'est plus un
budget. La marche à suivre était de mesurer au calme, et c'est ce qui a été fait :

```
npm run wp:down
uptime                      # noter la charge AVANT
node scripts/inflate-verify.mjs
uptime
npm run wp:up
```

Si à charge basse il passe, il n'y a rien à corriger. S'il échoue encore, le budget est
vraiment trop serré pour cette machine et cela se dit avec les deux mesures côte à côte.

### 3.3 `npm run verify:mockups` : VERT, 16 prises sur 16

**Premier passage complet du contrôle, le 26/08/2026 : PASS, sortie 0**, `.qa/mockups4`.
Les deux gardes de cadrage du gros plan passent (t-shirt 0,799 / -0,952, sweat
0,606 / -0,801), les quatre re-demandes sont identiques à l'octet, et la régénération dans un
contexte de navigateur neuf l'est aussi. Les 16 images sont identiques à l'octet entre deux
passages complets indépendants.

Il a fallu deux corrections, pas une. La première était le délai d'immobilisation de 300 s
(voir plus bas). La seconde n'a été visible qu'une fois la première levée : le contrôle
gardait le PREMIER contexte ouvert en ouvrant le neuf, donc deux contextes WebGL et deux
copies de la scène vivaient en même temps sans carte graphique, et le montage « neuf »
concurrençait la scène qu'il devait remplacer. Il est fermé avant, ce qui est la vraie
correction ; les budgets restants sont passés à 900 s par cohérence.

Ce qui suit décrivait l'état d'avant.

**12 prises sur 16**, puis expiration de l'attente d'immobilisation (300 s) sur la treizième,
le sweat vierge. Ce n'est pas un contrôle qui échoue, c'est le harnais qui renonce : les
prises du sweat prenaient 8 à 9 minutes chacune, et 300 s ne suffisent pas à charge 10,8.

Ce qui a été mesuré et qui compte : **le nouveau garde de cadrage du gros plan passe sur les
deux vêtements**, t-shirt à `0,799 / -0,952` et sweat à `0,606 / -0,801` en coordonnées
normalisées. C'est l'assertion qui lisait `-1,11` avant la correction de la profondeur.

À faire avant de relancer : le délai de 300 s à `scripts/mockup-shots.mjs:239` est un budget
de harnais, pas une assertion. Le monter (900 s) ne relâche rien.

### 3.4 `scripts/worn-qa.mjs`

**Cassé par défaut, et ce n'est pas la séance qui l'a cassé.** Il n'appelle jamais
`mkdirSync`, donc il meurt en `ENOENT` si le dossier de sortie n'existe pas, et son `OUT`
par défaut est un chemin absolu vers un bac à sable d'une session qui n'existe plus.
Correctif : une ligne, `mkdirSync(OUT, { recursive: true })`, et un défaut sur `.qa/worn`
comme les autres scripts.

Ce qu'il montrerait : si l'avatar est assez bon pour une photo « porté ». La réponse est
déjà connue par une autre voie, `parity-verify` mesure une dérive de **0,111** entre tailles
sur l'avatar contre **0,005** en 2D et en 3D, c'est-à-dire qu'il ne se décline pas. Le refus
est écrit dans `scripts/mockup-shots.mjs` et la question produit est la **Q52** de
`QUESTIONS-ASSOCIE.md`. L'image ne changerait pas la décision, elle l'illustrerait.

### 3.5 L'avant/après : FAIT, et il corrige une attribution

**Les deux moitiés ont tourné le 26/08/2026**, même fichier de script, même machine, même
heure : `.qa/before-3d-fixed` sur l'arbre `4767e40` (avant la séance) et `.qa/after-3d-now`
sur l'arbre courant. Sortie 0 des deux côtés, 14 images chacune.

**Ne pas écrire « à instrument constant », ce serait faux**, et c'est exactement l'erreur que
cette section corrige par ailleurs. Le fichier est le même, le chemin exécuté ne l'est pas :
la sonde d'immobilisation attend `window.__pose.fit.measured`, or l'arbre d'avant expose un
`__pose` qui ne porte que `{cam, tgt, goal}` (`git show 4767e40:src/three/Stage.tsx`, la
sonde y est en bas du composant et n'a pas de champ `fit`). La moitié « avant » ne pouvait
donc pas satisfaire ce prédicat et est retombée sur le `.catch` et son délai, ce que le
script prévoit explicitement pour un arbre sans la sonde.

Cela ne retire rien à la conclusion : elle ne demande que des images posées des deux côtés, et
douze des quatorze paires diffèrent sur 70 à 84 % de leurs pixels, ce qui n'est pas un écart
d'amortissement. Cela retire la formule.

**Ce qu'il corrige.** Ce tableau disait « 14 sur 14 distinctes, contre 10 sur 14 avant la
correction de la demande de vue ». C'est faux, ou du moins non démontré : le script ET le
studio ont été corrigés dans la même séance, et à instrument constant l'arbre d'AVANT donne
lui aussi **14 images distinctes sur 14**. Les doublons de la planche venaient donc des
captures prises en cours d'amortissement, pas du studio. Le défaut du studio est réel, mais
il est prouvé par la mesure directe de l'azimut (`?v=front` laissait -0,638 au lieu de 0, et
le deuxième `setView` ne faisait rien), pas par cette planche.

**Ce qu'il montre.** Douze des quatorze prises changent sur 70 à 84 % de leurs pixels, et
toutes dans le même sens : plus clair. Un t-shirt noir de face passe d'une moyenne de
16,1/17,5/20,7 à 32,2/36,4/43,4, le sweat sombre en studio de 19,8/21,5/24,8 à
38,5/43,1/50,9. C'est ce que la séance a fait de délibéré : le duvet du t-shirt monté de 0,32
à 0,62, la carte d'occlusion cuite du t-shirt mise à zéro parce que son île arrière est une
tache noire, la cavité mesurée qui reprend toute la charge, et les contre-jours ajoutés.

**Les deux prises `inflate-*` sont identiques à l'octet.** C'est le piège que la consigne de
séance nommait : améliorer le vêtement de catalogue ne doit pas toucher celui que le client
envoie.

Il faut dire exactement ce que cela mesure, sans quoi on lui fait dire plus. `inflate-*` est
la coque gonflée telle que le harnais d'ingestion la construit, et elle n'a pas bougé d'un
octet. Le vêtement téléversé tel qu'il apparaît DANS LE STUDIO, lui, a bien changé, et
délibérément : il lit la même configuration de scène que les autres, donc il a reçu les mêmes
lumières. Les prises qui le montrent sous cette forme sont `custom-34` et `custom-card-*`.
La phrase juste est donc : le chemin d'ingestion n'a pas été touché, et le rendu du résultat
a changé comme celui de tout le reste.

Pour refaire la moitié « avant ». **Pas sous `/tmp`** : `/tmp` est un tmpfs sur cette
machine, donc l'arbre de travail y occupe 109 Mio de RAM sur les 7,7 disponibles, et il
disparaît au redémarrage en laissant `git worktree list` désigner un chemin qui n'existe
plus. Le lien vers `node_modules` est nécessaire pour que vite démarre, et il a un effet de
bord qu'il faut connaître : tout ce qui tourne dans l'arbre détaché écrit son cache dans le
`node_modules/.vite` du dépôt vivant.

```
git worktree add --detach ~/.cache/teeshoop/pre10 1935798~1
ln -s /home/LTH/tshop/node_modules ~/.cache/teeshoop/pre10/node_modules
cp scripts/3d-shots.mjs ~/.cache/teeshoop/pre10/scripts/3d-shots.mjs
cd ~/.cache/teeshoop/pre10 && SHOT_PORT=5285 node scripts/3d-shots.mjs /home/LTH/tshop/.qa/before-3d-fixed
git worktree remove ~/.cache/teeshoop/pre10        # quand c'est fini, pas plus tard
```

L'« après » existe déjà dans `.qa/after-3d` (14 images, 14 poses distinctes). Le « avant »
n'a jamais tourné avec le script corrigé, donc les paires existantes dans `.qa/before-3d`
sont des poses prises en cours de mouvement et ne se comparent pas image à image.

`.qa/` n'est pas versionné : ces images sont locales et disparaissent avec la machine.

---

## 4. Ce qui n'a pas été construit, et qui se décide

Ces points ne sont pas des mesures manquantes, ce sont des choix. Ils sont détaillés dans
`docs/ROADMAP.md` sous « Ce que la séance 10 n'a pas fait ».

- **La vue « porté »** : refusée par écrit, l'avatar ne se décline pas en tailles. Q52.
- **La réutilisation des mockups** : rien ne relit `.qa/mockups`. Le panier, le bon à tirer
  et les e-mails montrent toujours l'aperçu plat de `renderMockup` déposé sur R2. Brancher
  le rendu 3D dessus est un projet, pas un raccord, et un bon à tirer n'a peut-être pas à
  être un rendu 3D du tout.
- **`src/app/ScenePicker.tsx`** : jamais ouvert. Aucun préréglage nouveau. Le sélecteur est
  aussi un `listbox` en ARIA et pas en comportement, ce qui appartient à la séance 12.
- **Le liseré d'encre** : la correction est de l'arithmétique démontrable mais il n'est pas
  gardé chiffré, parce que la mire de calibrage cerne ses propres lettres de noir. Il
  faudrait une mire à bords francs sans noir à elle.
