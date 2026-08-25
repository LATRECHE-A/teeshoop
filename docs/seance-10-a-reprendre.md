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
| `scripts/3d-shots.mjs` | 14 images sur 14 **distinctes** | contre 10 sur 14 avant la correction de la demande de vue |
| `scripts/frame-bench.mjs` | mesuré | voir `.qa/frame-bench-after2.json` et l'en-tête de `src/three/index.tsx` |

Construction, contre l'arbre d'avant la séance (`1935798~1`, worktree) :

```
première peinture   App-*.js      170,91  ->  170,93 kB   (+0,02)
morceau 3D paresseux three-*.js  1 133,25 -> 1 132,57 kB   (-0,68)
total JS                          2 469,28 -> 2 475,91 kB  (+6,63, entièrement en morceaux paresseux)
```

---

## 3. Ce qui n'est PAS mesuré, et pourquoi

### 3.1 `npm run verify:render`, les 14 cas

**Jamais lancé en entier sur cet arbre.** Le dernier balayage complet date de deux commits
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
l'écart de 2 % d'une image prise tard dans un balayage. `RENDER_DOUBLE=1` a été ajouté pour
trancher entre les deux causes qui restent (voir `docs/ROADMAP.md`), et **n'a pas encore été
lancé une seule fois** :

```
RENDER_DOUBLE=1 node scripts/render-verify.mjs .qa/render-double
```

Si les deux relectures d'une même image diffèrent, le défaut est dans la relecture du tampon
de dessin. Si elles sont identiques, c'est de l'état qui s'accumule dans le contexte WebGL
d'un cas à l'autre. Les deux réparations n'ont rien à voir.

### 3.2 `scripts/inflate-verify.mjs`

**Échoue sur une assertion de temps, deux fois, et la machine était chargée les deux fois.**

- 1 cas au-dessus du budget de 900 ms (1 358 ms) pendant que huit agents de lecture
  tournaient ;
- 7 cas au-dessus (914 à 2 136 ms) à charge moyenne 10,8.

Son propre en-tête dit que le même cas se construit en **216 ms machine libre** et a été
chronométré à **1 251 ms avec trois autres processus en concurrence**. Le chemin de code
qu'il mesure (`src/lib/ingest`) n'a pas été touché de la séance. Tout le reste du contrôle
(invariants du creux, déterminisme, portail vêtement / pas-vêtement) passe.

**Ne pas remonter le budget.** Un budget qui bouge pour s'adapter à la machine n'est plus un
budget. La marche à suivre est de mesurer au calme :

```
npm run wp:down
uptime                      # noter la charge AVANT
node scripts/inflate-verify.mjs
uptime
npm run wp:up
```

Si à charge basse il passe, il n'y a rien à corriger. S'il échoue encore, le budget est
vraiment trop serré pour cette machine et cela se dit avec les deux mesures côte à côte.

### 3.3 `npm run verify:mockups`

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

### 3.5 L'avant/après à instrument identique

Le worktree de l'arbre d'avant la séance est prêt et le script corrigé y est déjà copié :

```
git worktree add --detach /tmp/pre10 1935798~1     # s'il a disparu
ln -s /home/LTH/tshop/node_modules /tmp/pre10/node_modules
cp scripts/3d-shots.mjs /tmp/pre10/scripts/3d-shots.mjs
cd /tmp/pre10 && SHOT_PORT=5285 node scripts/3d-shots.mjs /home/LTH/tshop/.qa/before-3d-fixed
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
