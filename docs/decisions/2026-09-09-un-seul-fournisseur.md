# 9 septembre 2026 : un seul fournisseur

Décision de l'associé : la boutique achète chez **un seul** fournisseur. Tout ce
qui appartient à Falk & Ross sort du dépôt. Le fournisseur retenu est celui que
`wp-plugins/teeshoop-core/includes/SupplyHttp.php` sait déjà appeler, et dont
l'API a été mesurée en préproduction le 9 septembre 2026.

**Ce document est un plan d'exécution. Rien n'a encore été supprimé.** Chaque
ligne ci-dessous a été vérifiée par `grep` ou par lecture du fichier, sur la
branche `r0-securite-et-socle`, au commit `5b9dba9`. Les numéros de ligne sont
ceux de cet état ; ils bougeront dès la première suppression, donc l'ordre
d'exécution de la section 8 est fait pour qu'ils ne soient jamais lus deux fois.

---

## 1. Le périmètre, mesuré

`grep -rli` sur `falk`, hors `node_modules` et `.git` : **60 fichiers** portent
le nom. `grep -rl` sur `/api/fr/`, `/media/blank/` et `__fr-cache` : **30
fichiers**, dont 14 qui ne portent pas le nom. Union : **74 fichiers**.

Neuf sont hors de portée et ne seront pas touchés :

| Fichiers | Pourquoi ils ne bougent pas |
|---|---|
| `docs/bible/**` (8 fichiers) | Le brief de l'associé, vendu tel quel pour être greppable. On ne réécrit pas la source. |
| `docs/reponses-associe/reponses-q01-q36.txt` | Ses mots, à la virgule près. Une réponse citée ne se corrige pas. |

Restent **65 fichiers** à supprimer ou à modifier.

---

## 2. La règle de tri, et pourquoi c'est là qu'est le travail

Trois catégories, et une seule question pour les séparer :

> **Si ce code disparaît, le fournisseur suivant devra-t-il le réécrire ?**

- **(a)** Non, il ne servait qu'à parler à Falk & Ross. Il part.
- **(b)** Oui, et il le réécrirait moins bien, parce que ce fichier porte une
  leçon payée en production. Il reste, éventuellement renommé, jamais supprimé
  puis « refait ».
- **(c)** Le code ne connaît pas le fournisseur, seul un commentaire ou une
  documentation le nomme. C'est une reformulation, pas une suppression.

Se tromper sur (b) est la seule faute irréversible de cette opération : le code
part en une seconde et la mesure qui l'a produit ne revient pas. Chaque entrée
de la section 4 cite donc le commentaire qui porte la leçon.

---

## 3. (a) Ce qui part, fichier par fichier

### 3.1 Le Worker

| Chemin | Action | Ce qui casse, vérifié |
|---|---|---|
| `worker/falkross.ts` | **Supprimer le fichier** (2 315 lignes) | `worker/index.ts:47` (import), `worker/index.ts:63` (`Env extends FalkRossEnv`), `worker/index.ts:434` (appel), `worker/falkross.test.ts:46` (import), `worker/tsconfig.json:13` (include), `docs/hypotheses.json` entrée `H-Q09-FAMILLES` (ancre). Les cinq sont traités ci-dessous. |
| `worker/falkross.test.ts` | **Supprimer le fichier** (141 lignes) | Rien. Aucun autre fichier ne l'importe. Voir 4.7 : ce qu'il prouve doit être reconstruit, pas perdu. |
| `worker/__fixtures__/falkross/` | **Supprimer le répertoire** (12 XML, 451 Ko) | Seul `worker/falkross.test.ts:48` le lit. Le test s'assure lui-même qu'aucun fixture n'est orphelin (`it('exercises every fixture on disk')`), donc les deux partent ensemble ou pas du tout. |
| `worker/xml.ts` | **Supprimer le fichier** (282 lignes) | Vérifié : `grep -rn "from './xml'" worker/*.ts` ne rend **qu'une** ligne, `worker/falkross.ts:38`. Le lecteur XML n'existait que pour les flux du fournisseur. |
| `worker/tsconfig.json` ligne 13 | Remplacer `"include": ["index.ts", "falkross.ts", "xml.ts", "auth.ts", "containers.ts"]` par `"include": ["index.ts", "auth.ts", "containers.ts"]` | Sans cette ligne, `npm run typecheck:worker` échoue sur deux fichiers absents. |
| `worker/index.ts` lignes 27 à 39 | Supprimer les deux paragraphes `SUPPLIER:` et `/api/fr/* is ADMIN-ONLY`. Garder la ligne 40 (`POST /api/ar` reste ouverte). | Documentation seule. |
| `worker/index.ts` ligne 47 | Supprimer `import { handleFalkRoss, type FalkRossEnv } from './falkross'` | `tsc -p worker/tsconfig.json`. |
| `worker/index.ts` ligne 63 | `interface Env extends FalkRossEnv, DesignEnv, …` devient `interface Env extends AdminEnv, DesignEnv, …`, et ajouter `AdminEnv` à l'import de `./auth` ligne 48. **`AdminEnv` doit rester** : `ADMIN_TOKEN` garde `/api/nest`, `/api/design/reap` et la suppression RGPD. | Sans le remplacement, `ADMIN_TOKEN` n'est plus déclaré sur `Env` et `requireAdmin` ne compile plus. |
| `worker/index.ts` lignes 425 à 435 | Supprimer les onze lignes (commentaire `__fr-cache`, la garde 404, le commentaire `Supplier catalogue`, l'appel et le `if (supplier) return supplier`) | Voir 6.1 : c'est la ligne 429 qui décide du sort des photos par coloris. **À ne pas exécuter avant la migration.** |

### 3.2 Le studio

| Chemin | Action | Ce qui casse, vérifié |
|---|---|---|
| `src/lib/ingest/falkross.ts` | **Supprimer le fichier** (713 lignes) | `src/lib/ingest/frCache.ts:22`, `src/app/modals/CatalogModal.tsx:56-74`, `scripts/admin-boundary.mjs:44`. |
| `src/lib/ingest/frCache.ts` | **Supprimer le fichier** (124 lignes) | `src/app/modals/CatalogModal.tsx:75-82`, `scripts/admin-boundary.mjs:46`. Voir 4.11 : le motif de cache reste utile, l'instantané Falk & Ross non. |
| `src/app/modals/CatalogModal.tsx` lignes 56 à 82 | Supprimer les deux blocs d'import (`@/lib/ingest/falkross` puis `@/lib/ingest/frCache`) | `tsc --noEmit`. |
| `src/app/modals/CatalogModal.tsx` ligne 87 | `type Source = 'falkross' \| 'imbretex'` : supprimer la ligne entière, et avec elle l'onglet. Une seule source ne se choisit pas. | Lignes 1385, 1437, 1441 à 1445 (voir ci-dessous). |
| `src/app/modals/CatalogModal.tsx` lignes 91 à 93 | Supprimer `fmtWhen`. Vérifié : ses deux seuls appels sont lignes 343 et 822, tous deux dans la moitié Falk & Ross. | Rien. |
| `src/app/modals/CatalogModal.tsx` lignes 95 à 904 | Supprimer d'un bloc : le marqueur de section `FALK&ROSS` (95 à 97), `SizeOverride` (104 à 173), `FragmentSizeRow` (175 à 203), `FrCard` (205 à 260), `FrDetail` (262 à 541), `findSku` (544 à 548), `AUTO_ROUNDS` (551) et `FalkRossBrowser` (553 à 904) | Voir 9, point 4 : `SizeOverride` est le seul morceau de ce bloc qui n'est pas tranché. |
| `src/app/modals/CatalogModal.tsx` lignes 1 à 20 | Réécrire l'en-tête : il annonce « TWO SOURCES, ONE PIPELINE ». Il en reste une. | Documentation. |
| `src/app/modals/CatalogModal.tsx` ligne 1385 | Supprimer `const [source, setSource] = useState<Source>('falkross')` | Lignes 1410 à 1426 (`tab`) et 1436 à 1445. |
| `src/app/modals/CatalogModal.tsx` lignes 1410 à 1426 | Supprimer la fonction locale `tab` | Elle n'a plus qu'un onglet à rendre. |
| `src/app/modals/CatalogModal.tsx` lignes 1436 à 1445 | Remplacer d'un bloc le `<div className="flex gap-2">` de ses deux onglets (1436 à 1439) et le ternaire (1441 à 1445) par `<ImbretexBrowser t={t} onApplied={(p) => void applied(p)} />` seul, dans le `<div className="flex flex-col gap-4">` qui reste | Un sélecteur à un seul choix est du bruit d'interface, interdit par `CLAUDE.md` section 7. |
| `src/app/modals/CatalogModal.tsx` | Conserver `swatch` (ligne 89) et `type Busy` (ligne 86). Vérifié : `swatch` est appelé lignes 964 et 1116, `Busy` lignes 992 et 1229, dans la moitié Imbretex. | Suppression par erreur = `tsc` rouge. |
| `src/app/modals/catalogI18n.ts` lignes 25 à 29 et 168 à 172 | Supprimer le marqueur `--- sources ---` et les quatre clés `catalog.source.*` des deux langues. L'onglet a disparu, les deux libellés avec. | Lignes 1437 et 1438 de `CatalogModal.tsx`, déjà traitées. |
| `src/app/modals/catalogI18n.ts` lignes 31 à 95 | Supprimer le bloc `--- Falk&Ross ---` : 55 clés `catalog.fr.*` | Toutes appelées uniquement dans les lignes 95 à 904 de `CatalogModal.tsx`, supprimées ci-dessus. |
| `src/app/modals/catalogI18n.ts` lignes 174 à 238 | Le même bloc, moitié anglaise | Idem. |
| `src/app/modals/catalogI18n.ts` | **Conserver** `catalog.entry.title` et `catalog.entry.cta`. Vérifié : `src/admin/AdminSlots.tsx:116` et `:119` sont leurs seuls autres lecteurs. | Suppression = carte d'entrée d'administration vide. |

### 3.3 Les scripts

| Chemin | Action | Ce qui casse, vérifié |
|---|---|---|
| `scripts/fr-verify.mjs` | **Supprimer le fichier** | `package.json:39` (`"verify:fr"`), `README.md:350`, `.claude/skills/verify/SKILL.md:67`, `.github/workflows/ci.yml:31`. Ce harnais appelle `ws.falk-ross.eu` en HTTP Basic : il n'a aucune traduction vers le nouveau service, qui est en jeton porteur et en OAuth2. |
| `scripts/purchase-bench.mjs` | **Supprimer le fichier** | `package.json:40` (`"bench:achats"`). Les constantes lignes 37 et 38 sont les hôtes du fournisseur. |
| `scripts/catalog-verify.mjs` | **Supprimer le fichier** | `README.md:241`, `src/admin/main.tsx:11`, `.claude/skills/verify/SKILL.md:67` et `:75`. Il monte un faux serveur qui sert `/api/fr/state`, `/api/fr/styles`, `/api/fr/style/18001`, `/api/fr/price/*` et `/api/fr/stock/*` (lignes 84 à 88) : cinq routes qui n'existeront plus. **Il n'est appelé par aucun script de `package.json` ni par la CI**, vérifié : `grep -rn "catalog-verify"` ne rend que de la documentation. |
| `package.json` lignes 39 et 40 | Supprimer `"verify:fr"` et `"bench:achats"` | Sans ça, deux entrées pointent sur des fichiers absents. |
| `scripts/admin-boundary.mjs` lignes 44 et 46 | Supprimer `'src/lib/ingest/falkross.ts'` et `'src/lib/ingest/frCache.ts'` de `ADMIN_ONLY` | **Attention, mesuré** : `ADMIN_ONLY` est un filtre sur le graphe atteint (`admin-boundary.mjs:86`, `src/app/adminBoundary.test.ts:100`). Une entrée qui nomme un fichier absent ne correspond simplement à rien : **aucun test n'échoue**. C'est la seule ligne de ce plan dont l'oubli est silencieux. |
| `scripts/dev.mjs` ligne 7 | Reformuler le commentaire | Documentation. |

### 3.4 La configuration

| Chemin | Action | Ce qui casse, vérifié |
|---|---|---|
| `wrangler.jsonc` lignes 9 à 21 | Supprimer les quatre commentaires `wrangler secret put FR_*`. **Garder** les lignes 7 et 8 (`ADMIN_TOKEN`). | Documentation, mais c'est le seul endroit où les secrets du Worker sont listés. |
| `wrangler.jsonc` ligne 23 | `Declared on the Worker's Env interface in worker/falkross.ts (FalkRossEnv)` devient `… dans worker/auth.ts (AdminEnv)` | Documentation. |
| `wrangler.jsonc` lignes 35, 40, 52 à 56 | Retirer la mention `Falk&Ross` ligne 35 et l'entrée `/__fr-cache/*` de l'historique lignes 52 et 53. **Garder l'entrée `/media/blank/*` lignes 54 à 56 jusqu'à la migration 6.1**, et la supprimer avec elle. | La ligne 429 de `worker/index.ts` et cette note sont le même sujet. |
| `.dev.vars` (non suivi par git) | Retirer `FR_WS_USER`, `FR_WS_PASS`, `FR_CUSTOMER_NR` et leurs commentaires. **Garder** `ADMIN_TOKEN`. Sort de ce fichier : `FR_ORDER_TOKEN`, voir 7. | `scripts/fr-verify.mjs:44` et `scripts/purchase-bench.mjs` le lisaient ; tous deux supprimés. |
| `.env.production` | **Aucune modification.** Vérifié en lisant le fichier : il ne contient que `VITE_TEESHOOP_SHOP_ORIGINS`. Le brief supposait le contraire. | Rien. |
| `.gitignore` ligne 8 | `# Worker secrets for local dev (Falk&Ross webservice credentials).` devient `# Secrets du Worker pour le développement local.` | Documentation. |
| `vite.config.ts` ligne 51 | Reformuler : « le Worker est ce qui tient les identifiants Falk&Ross » devient « le Worker tient les secrets ». Le proxy `/api` reste, `/api/ar`, `/api/design` et `/api/nest` en dépendent. | Documentation. |
| `.github/workflows/ci.yml` lignes 723 à 727 | Reformuler le commentaire (« les identifiants du webservice Falk&Ross ouvrent le catalogue »). | Documentation. |
| `.github/workflows/ci.yml` ligne 736 | `printf 'ADMIN_TOKEN=%s\nFR_ORDER_TOKEN=%s\n'` : voir 7, `FR_ORDER_TOKEN` ne disparaît que quand la route d'achat est réécrite. | Voir 7. |
| `.github/workflows/ci.yml` lignes 31 à 35 | Réécrire le paragraphe « ce qui reste dehors » : `verify:fr` n'existe plus, `verify:wp-catalogue` reste dehors pour la même raison, contre l'autre service. | Documentation. |

---

## 4. (b) Ce qui doit survivre, et la leçon citée

Ces onze points ne sont **pas** dans la liste de suppression. Chacun est une
règle payée par un incident, et chacun est reformulable sans le nom du
fournisseur. Le commentaire qui la porte est cité pour que la reprise puisse
être vérifiée mot pour mot.

### 4.1 La forme de charge utile `FrCatalogueEntry` : une erreur par section, jamais un `null` nu

`worker/falkross.ts:1470-1476` et son docblock lignes 1441 à 1468 :

> « PRICES AND STOCK ARE NULLABLE, AND THE REASON TRAVELS WITH THEM. A style the
> supplier publishes no price for and a style we could not ask about are
> different facts, and the importer must treat them differently: the first is
> "not sellable", the second is "come back later, change nothing". Collapsing
> them into a bare null is how a network blip empties a shop. So the section is
> null and `pricesError` / `stockError` say which it was. »

C'est `CLAUDE.md` section 3 appliqué à une charge utile. La structure
(`style`, `prices`, `pricesError`, `stock`, `stockError`, le style jamais nul)
est le contrat que `Supply::entry()` et `Importer` lisent déjà. **Elle doit
réapparaître à l'identique du côté PHP**, et `SupplyHttp::get()` la rend
possible : son `reason` (`config | transport | auth | upstream | bad_request |
parse`) est exactement le vocabulaire qu'il faut mettre dans `pricesError`.

Le `Promise.allSettled` de `loadCatalogueEntry` (ligne 1537) porte la même règle
sur une ligne de code :

> « Settled, not `all`: a stock outage must not cost us the prices we did get. »

### 4.2 « Un instantané sans lignes n'est pas l'instantané d'un entrepôt vide »

`worker/falkross.ts:1362-1373` :

> « A SNAPSHOT WITH NO ROWS IS NOT A SNAPSHOT OF AN EMPTY WAREHOUSE. The upstream
> CGI answers HTTP 200 with a timestamp and nothing else when it is rebuilding,
> and a sweep that believed it would write zero onto every article in the shop,
> which reads on a product page as « rupture » on the entire catalogue. Refusing
> costs one stale hour; believing it costs a day of sales. »

Le nouveau service a **le même piège sous une autre forme**, mesuré ce soir :
`GET /prices` de la base B rend `TOTAL 0` en préproduction, et le flux de prix
en masse omet 42 % des codes. Une passe qui croirait ces deux réponses écrirait
un catalogue sans prix. La règle doit donc être portée telle quelle, et elle est
plus urgente qu'avant, pas moins.

### 4.3 La discipline de l'horodatage de stock

`worker/falkross.ts:1332-1338` :

> « THE FIRST LINE IS THE SNAPSHOT'S OWN TIMESTAMP, and it is the point of this
> route rather than a detail. The Bible's one substantive rule about stock
> (chapter 05, « Réservation et confirmation ») is that « le stock affiché par
> une API n'est pas une garantie absolue. Le système doit enregistrer la date de
> consultation ». A quantity without the moment it was read cannot be shown
> honestly, so `at` travels with every page and the shop stores it per article. »

Et la conséquence, `worker/falkross.ts:2196-2200` :

> « `at` IS PER PAGE, DELIBERATELY. A sweep takes several requests and the
> five-minute cache can turn over between them, so pages can come from two
> snapshots. The shop stores the freshness carried by the page that wrote each
> article, which makes a mixed sweep exactly as honest as a clean one instead of
> something to detect. »

Le nouveau service **n'a pas d'horodatage d'instantané** : `price-stock` répond
au fil de l'eau, code par code. L'horodatage devient donc l'heure de l'appel,
côté boutique, et il doit être posé au moment où la ligne est écrite, pas au
début de la passe. La règle survit, son implémentation change, et c'est une
chose à écrire dans le nouveau `Supply.php` plutôt qu'à redécouvrir.

`ACCES-REQUIS.md:67` en dépend déjà : « Les relevés vieillissent et la boutique
dit "Délai à confirmer", ce qui est correct et non une panne. »

### 4.4 Le dépublication exige une marche complète

Vit **déjà côté PHP**, donc survit à la suppression du Worker, mais dépend d'un
champ que le Worker fabriquait. `wp-plugins/teeshoop-core/includes/Supply.php:227-238` :

> « A LOSSY WALK IS NOT A COMPLETE ONE. The catalogue endpoint drops a style
> whose document it could not read and reports how many. In `items` that style is
> indistinguishable from one the supplier has withdrawn, and the only thing that
> reads `complete` is the sweep that UNPUBLISHES withdrawn references. One
> unreadable document must not cost a product that is on sale, so any drop
> demotes the walk to incomplete and nothing is delisted from it. »

Et `Supply.php:206-211` :

> « Stopped short ON PURPOSE, and `complete` stays false. That flag is the single
> condition the delisting sweep checks, so a partial walk can never unpublish
> anything: a reference we did not meet is not a reference the supplier dropped. »

**Ce que la suppression du Worker enlève**, et qu'il faut reconstruire :
`nextOffset` et `dropped`. Le nouveau service pagine par `page` et `perPage`
(50 au maximum, 65 pages, 94 s, 250 Mo mesurés). Une marche complète est donc
« j'ai lu la page N et elle est revenue vide », et `dropped` devient « nombre de
produits dont le document n'a pas pu être lu ». Sans ces deux nombres,
`Importer::delist()` n'a plus de garde et **dépublierait la boutique entière à la
première page en erreur**.

`Catalogue::META_FAMILY` (`Catalogue.php:141-145`) porte la moitié complémentaire
de la même règle et ne bouge pas :

> « A run asked for `tee` must not conclude that every polo has disappeared from
> the supplier because it did not meet one. »

### 4.5 L'alias photo, et le fait qu'il n'est pas cosmétique

`worker/falkross.ts:1478-1492` :

> « `/api/fr/` is on `scripts/php-guard.mjs`'s forbidden list because it names who
> we buy from, and a rule that the plugin's source obeys while its database
> quietly publishes the same string is a rule we are pretending to follow.
> `PHOTO_ALIAS` is the same bytes from the same handler under a name that says
> nothing about the supplier. »

Et `aliasSizespec`, lignes 1498 à 1508 :

> « An unrecognised URL becomes '' rather than being passed through: a
> half-anonymised field is worse than an absent one, because it looks safe. »

Le nouveau transport fait déjà l'aveu inverse : `SupplyHttp::media_url()` rend
une URL **absolue sur l'hôte média du fournisseur**. Si cette URL est stockée sur
la variation, le domaine du fournisseur part dans la base et sur la fiche
produit, ce que l'alias existait précisément pour empêcher. Deux sorties
possibles, et c'est une décision, pas un détail d'implémentation :

1. l'importateur **télécharge** les photos par coloris (267 Mo, environ 1 h 30
   d'import, mesuré, `docs/CATALOGUE.md:246`), et `media_url()` ne sert plus qu'à
   aller les chercher ;
2. la boutique garde un relais neutre à elle, comme `/media/blank/` mais servi
   par WordPress.

**Ne rien décider revient à choisir la fuite.** Voir 6.1.

### 4.6 `publicPrice` n'est pas un prix de vente

`worker/falkross.ts:1226-1245` :

> « `list` IS NOT A LIST PRICE, whatever the name suggests. […] A price we are
> charged MORE than cannot be a recommended retail price […] Crossing it out
> beside ours would advertise a discount that does not exist, which in France is
> a prix de référence fictif and unlawful. The cart shipped exactly that mistake
> once already. »

Le nouveau flux en masse a un champ `publicPrice`, mesuré **sous le prix
d'achat** sur de nombreuses lignes : c'est le même piège, le même nom trompeur,
le même délit. Cette leçon doit voyager dans le nouveau `Supply.php`, au-dessus
du champ, avec les quatre chiffres qui la prouvent. C'est aussi ce que dit la
consigne de la nuit : « must never be shown or used ».

### 4.7 Le classement en rayons, et la seule chose qui en est réutilisable

`worker/falkross.test.ts` et `classifyShelf` sont **le seul endroit du dépôt qui
sait ranger 2 309 produits en 11 rayons**, et c'est le travail du 4 septembre
2026 (« Autres textiles » passé de 1 744 à 236). Il faut séparer trois couches :

| Couche | Sort |
|---|---|
| **L'énumération `FrShelf`** (`worker/falkross.ts:397-407`) : `tshirt`, `polo`, `sweat`, `chemise`, `veste`, `casquette`, `bonnet`, `sac`, `tablier`, `maison`, `autre` | **(b) contrat.** Vérifié : c'est exactement `Catalogue::SHELVES` (`Catalogue.php:314-326`), et `Importer.php:577` refuse un article dont le rayon n'y est pas. Ces onze valeurs voyagent, quel que soit le fournisseur. |
| **Les quatre règles de méthode** | **(b).** Elles ne parlent d'aucun fournisseur, et chacune a coûté une mesure. |
| **Le vocabulaire** (`SHELF_BY_GROUP`, `SHELF_BY_CATEGORY`, `GROUP_NOT_AN_AISLE`, `CATEGORY_VETO`, `NAME_VETO`, `KIND_PATTERNS`) | **(a).** Ce sont les libellés anglais de Falk & Ross (« Horeca & Care », « Beanies & Accessories »). Ils ne veulent rien dire chez l'autre. |

Les quatre règles, citées :

> « The four printable kinds keep their own aisle, so this never disagrees with
> `classifyKind`. » (`falkross.ts:688-690`)

> « A WHITELIST AND NOT A REGULAR EXPRESSION, because the group list mixes
> product types with attributes […] A pattern would match the attributes; an
> exact table can only match what it was told about. » (`falkross.ts:616-621`)

> « refuses an aisle the shop does not have rather than choosing the nearest.
> MEASURED […] 41 of the 410 styles the supplier files under « Caps & Hats » are
> not headwear. Nineteen pairs of gloves, eighteen scarves or snoods, three
> headbands. » (`falkross.test.ts:103-105`, `falkross.ts:671-681`)

> « Nothing is guessed from a name […] « Tee Jays Luxury Stretch Shirt » is a
> polo, and « Recycled Fleece Hood » is a fleece beanie, not a hoodie. »
> (`falkross.ts:692-694`, `falkross.test.ts:137`)

Et la méthode du test lui-même, qui est la leçon la plus chère du fichier :

> « WHY REAL XML AND NOT A STUB. […] A fixture written by hand would be a fixture
> written by whoever wrote the rule, and it would agree with the rule for that
> reason alone. » (`falkross.test.ts:4-10`)

**Ce que cela impose au plan** : la suppression de `falkross.test.ts` et de ses
12 fixtures n'est acceptable **qu'accompagnée** de son remplaçant, construit de
la même façon (documents réels du nouveau service, non retouchés, chaque cas
choisi parce qu'il est difficile et non parce qu'il passe) et couvrant les mêmes
onze rayons. Le supprimer seul rend le classement invérifiable sur 2 309 fiches.

### 4.8 Le budget de sous-requêtes, si le Worker reste dans la boucle

`worker/falkross.ts:1002-1005` :

> « A spend-before-you-act budget. `take` reserves the WORST case and refuses
> rather than over-spending, so the caller can stop cleanly and report
> `nextOffset` instead of throwing halfway through a page. »

`worker/design.ts:459-462` cite déjà cet incident depuis un autre fichier
(« That ceiling has already taken this project down in production once, see the
budget section in worker/falkross.ts »). **Cette référence croisée devient morte
en supprimant le fichier** : la phrase doit être recopiée dans `design.ts`, pas
seulement repointée, sinon la mesure disparaît du dépôt.

Si le nouveau catalogue passe par PHP et non par le Worker, la contrainte change
de nature (temps d'exécution PHP et mémoire, pas sous-requêtes) mais la forme
« réserver le pire cas et refuser proprement » reste la bonne.

### 4.9 Une commande fournisseur ne se rejoue jamais

`worker/falkross.ts:1586-1589` :

> « A lost response is its own answer. `outcome: 'unknown'` means the document may
> or may not have been received, and the shop records that and refuses to retry
> blind. Conflating it with a failure is how a delivery arrives twice. »

Et le numéro de client, lignes 1568 à 1573 :

> « The customer number comes from `FR_CUSTOMER_NR` ONLY. The old code fell back
> to the leading digits of the webservice login and reported that it had; a
> guessed number that decides which account is billed is exactly what this
> project forbids. »

`SupplyHttp::post_json()` porte déjà la moitié transport de cette règle :

> « JAMAIS REPRIS, À AUCUN NIVEAU. La seule route POST de ce service crée une
> commande fournisseur : une seconde tentative produit une seconde livraison, et
> le silence de la première n'est pas la preuve qu'elle n'est pas arrivée. »

Manquent, à porter dans le nouveau `Supply::place_order()` : les quatre issues
(`accepted | partial | rejected | unknown`), la clé d'idempotence envoyée comme
référence de commande, et l'exigence que l'appelant **déclare** le mode qu'il
croit (test ou réel) pour qu'un décalage refuse avant de construire le document.

### 4.10 Le nom du fournisseur ne doit jamais entrer dans le greffon

`scripts/php-guard.mjs` : les aiguilles `Falk & Ross`, `Falk&Ross`, `falkross`
**restent**. Elles ne coûtent rien et elles défendent contre la réintroduction du
nom par une description produit recopiée ou un copier-coller d'ancien code. Voir
5.2 pour ce qu'il faut y ajouter.

Et la moitié que seul un site en marche peut voir, `scripts/wp-catalogue-verify.mjs:410-416` :

> « The supplier writes its own stock announcements into the style description
> ("CLOSE-OUT: ce style est retiré de la collection <notre fournisseur>"), and two
> of them were live on customer product pages. php-guard could not see them: it
> reads repository files, and that string only ever existed in `wp_posts`. »

Le contrôle reste, l'aiguille `'%collection Falk%'` (ligne 421) devient celle du
nouveau fournisseur. Elle ne peut pas être devinée : il faut lire une description
de fin de série du nouveau service et prendre la chaîne réelle. **Une aiguille
inventée rendrait ce contrôle vert sans rien chercher**, ce que `CLAUDE.md`
section 5 interdit.

### 4.11 Le motif d'instantané hors ligne

`src/lib/ingest/frCache.ts:1-19` :

> « a catalogue that answers a dead error page to a returning user is a worse
> product than one that shows what it showed yesterday and SAYS SO. […] This is a
> stale-WHEN-broken cache, not a stale-while-revalidate one […] Prices and stock
> are deliberately NOT snapshotted: they are the two fields whose staleness costs
> money. »

Le fichier part (il ne cache que des types Falk & Ross). La règle « on met en
cache la fiche, jamais le prix ni le stock » est à réécrire au-dessus de ce qui
la remplacera, du côté où sera le nouveau catalogue.

---

## 5. (c) Ce qui n'est qu'une reformulation

Aucune de ces lignes ne change un comportement. Elles nomment le fournisseur
dans un commentaire ou une documentation.

### 5.1 Code

| Chemin et ligne | Ce qu'il faut écrire |
|---|---|
| `worker/auth.ts:4-9` | Le paragraphe « WHY THIS EXISTS » explique la porte par `/api/fr/*`. Après suppression, la porte tient `/api/nest`, `/api/design/reap`, `DELETE /api/design/{id}` et `/admin*`. Réécrire en nommant ces routes. **La règle fail-closed lignes 11 à 19 ne bouge pas d'un caractère.** |
| `worker/design.ts:463` | Voir 4.8 : recopier la mesure, ne pas juste repointer. |
| `worker/nest.ts:28` | « The gate is the same `requireAdmin` as `/api/fr/*` » devient « la même porte `requireAdmin` que les routes d'administration ». |
| `worker/cors.test.ts:216-217` et `:225` | Le cas `['/api/fr/catalog', …]` doit être **remplacé**, pas supprimé. Attention, mesuré : sans route `/api/fr/*`, cette entrée tombe sur le repli monopage, qui ne pose pas non plus d'en-tête CORS. **L'assertion resterait verte sans rien mesurer.** Remplacer par `/api/design/reap` (POST, admin) ou par la suppression, qui sont de vraies routes gardées. Ligne 230, `/__fr-cache/anything` sort avec la garde de `worker/index.ts:429`. |
| `scripts/cors-verify.mjs:37` et `:265` | Même remarque, même remplacement. Ce harnais tourne dans la CI (travail `navigateur`), donc une assertion devenue creuse y serait un vert menteur permanent. |
| `src/lib/admin/token.ts:2` | « The admin bearer token for `/api/fr/*` » devient « pour les routes d'administration du Worker ». |
| `src/lib/ingest/types.ts:104-113` | Le docblock de `SizeSource` cite Falk & Ross comme le cas qui a forcé `'reference-chart'`. **Garder la règle**, remplacer le nom par « le fournisseur qui a forcé cette valeur ne publiait que des libellés de taille ». `SizeSource` lui-même ne bouge pas. |
| `src/app/backOriginI18n.ts:5-10` | Le docblock explique la coupure d'import par le fait que `catalogI18n` porte « our Falk&Ross account » et « our secret NAMES ». Reformuler. **Le fichier reste dans `MUST_REACH`** (`admin-boundary.mjs:38`) : c'est la moitié client, elle ne bouge pas. |
| `src/lib/ingest/imbretex.ts` | **Aucune modification dans cette passe.** Il lit l'extrait public hors ligne, pas la nouvelle API. Le remplacer par l'API en direct est un autre chantier, à ne pas mélanger avec une suppression. |
| `scripts/vitrine-verify.mjs:29` | Reformuler. |
| `scripts/couleurs-guard.mjs:60` | Ne nomme pas le fournisseur, mais dépend de `/media/blank/`. À revoir avec 6.1. |
| `wp-plugins/teeshoop-core/includes/Supply.php` | **Réécrit séparément.** Voir section 9. |

### 5.2 `scripts/php-guard.mjs` et `scripts/bundle-guard.mjs` : ce qu'on ajoute

Ce ne sont pas des suppressions, ce sont des ajouts, et c'est le point le plus
facile à oublier : **la nouvelle porte doit garder le nouveau nom.**

| Fichier | À ajouter |
|---|---|
| `scripts/php-guard.mjs` catégorie `supplier` (après la ligne 74) | Le nom du nouveau fournisseur dans ses deux ou trois graphies, et son domaine. `Imbretex` et `imbretex` **y sont déjà** (lignes 66 et 67) : vérifier que ce sont bien les bonnes graphies pour le service branché. |
| `scripts/php-guard.mjs` catégorie `purchase-cost` | `TEESHOOP_SUPPLY_TOKEN`, `TEESHOOP_SUPPLY_CLIENT_SECRET`. Les deux ouvrent le catalogue et nos prix d'achat, exactement comme `FR_WS_USER` et `FR_WS_PASS` lignes 57 et 58, **qui restent** (une aiguille morte ne coûte rien, sa non-vacuité est prouvée par la sonde `Teeshoop` ligne 450). |
| `scripts/php-guard.mjs` `ALLOWED` ligne 152 à 155 | L'exemption de `Supply.php` nomme l'aiguille `/api/fr/`. Après réécriture, `Supply.php` n'appelle plus le Worker : **l'exemption doit être supprimée**, pas transférée. `SupplyHttp.php` n'a besoin d'aucune exemption, il ne contient aucun littéral. |
| `scripts/bundle-guard.mjs` `FORBIDDEN` | Ajouter `TEESHOOP_SUPPLY_TOKEN` et `TEESHOOP_SUPPLY_CLIENT_SECRET` en catégorie `cost`. Retirer `{ s: 'tshop:fr:', cat: 'supplier-api' }` (ligne 72) **seulement** avec `frCache.ts`, qui est le seul à écrire ce préfixe. `/api/fr/` ligne 71 sort avec la route. |

Preuve de non-vacuité exigée par `CLAUDE.md` section 1 : après modification,
faire échouer chaque garde une fois, dans la transcription. `php-guard.mjs`
accepte `--self-test` ; `bundle-guard.mjs` accepte `--dist <chemin>` avec un
build d'avant la coupure.

### 5.3 Documentation

| Chemin | Lignes | Nature |
|---|---|---|
| `README.md` | 133, 141, 199, 213 à 235, 270 à 271, 312 à 316, 324, 335 à 337, 350, 366, 390 | Le paragraphe d'installation des secrets et la section catalogue sont à réécrire en entier, pas ligne à ligne. |
| `ACCES-REQUIS.md` | 17, 65, 66, 472 à 560, 747 à 753, 809, 817, 1110, 1192, 1329 à 1334 | Voir section 7 : c'est la passe unique sur les secrets. |
| `QUESTIONS-ASSOCIE.md` | 104, 159, 300, 418, 424, 855 à 880, 1480, 1486, 1510, 2283, 2427, 2565 | **Ne pas réécrire l'historique.** Ces lignes sont des questions posées et des réponses reçues. Ajouter une note datée du 9 septembre 2026 disant que la question 9 est tranchée et par quoi, sans toucher au texte au-dessus. |
| `docs/ROADMAP.md` | 402, 1232, 1274 | La ligne 1232 est une séance faite ; la barrer autrement serait réécrire l'histoire. Ajouter la nouvelle. |
| `docs/SECURITE.md` | 253, 266, 268 | La ligne 268 cite `falkross.ts:1841`, un numéro de ligne dans un fichier supprimé. Le remplacer par la règle, pas par un autre numéro. |
| `docs/ACHATS.md` | 207, 222, 228, 245 | Le second secret et le numéro de client. Voir 7. |
| `docs/CATALOGUE.md` | 14, 24, 117, 241, 246, 256, 320 | C'est la documentation du chemin d'import. Elle décrit une architecture qui disparaît. À réécrire après, pas pendant. |
| `docs/DEPLOIEMENT.md` | 489, 492, 494, 495 | Le tableau des secrets. Voir 7. |
| `docs/CONCURRENTS.md` | 202, 210 | Étude de marché : `falk-ross.eu` y est cité comme **site public observé**, pas comme notre fournisseur. Ligne 202 dit « qui est notre propre fournisseur » : c'est cette incise qui saute, pas l'observation. |
| `docs/COULEURS.md` | 469 | « nuancier Falk&Ross » comme source possible de valeurs officielles. Remplacer par le nouveau. |
| `docs/seance-12-a-reprendre.md` | 165 | Cite la liste `include` de `worker/tsconfig.json`. Mettre à jour. |
| `docs/decisions/2026-09-03-…md` | 35 | Décision datée. Ne pas réécrire : ajouter une note de renvoi vers ce document. |
| `docs/decisions/2026-09-05-…plancher.md` | 168 | Idem. |
| `docs/hypotheses.json` | entrée `H-Q09-FAMILLES`, champ `mirrors[0].ref` | **Bloquant, mesuré.** Voir 8. |
| `todo.md` | 16 | Note du développeur. Une ligne. |
| `wp-plugins/teeshoop-core/README.md` | 979 à 980 | Le contrat du greffon. À réécrire avec `Supply.php`. |
| `.claude/skills/perf/SKILL.md` | 26 | « `worker/falkross.ts` solves it with block caching » : la mesure reste vraie, le fichier disparaît. Recopier la mesure. |
| `.claude/skills/verify/SKILL.md` | 67, 75 | Retirer `catalog-verify` et `fr-verify` de la table des harnais. |
| `.claude/skills/security/SKILL.md` | 53 | Reformuler. |

---

## 6. Les deux choses qui ne sont pas des suppressions

Elles ressemblent à des lignes à effacer. Ce sont des migrations de données, et
les faire dans le mauvais ordre casse une boutique en production.

### 6.1 `/media/blank/` : 4 241 photos par coloris déjà en base

**Ce qui est vérifié :**

- `Importer.php:811` écrit `Catalogue::META_COLOUR_PHOTO` avec le chemin
  `/media/blank/picture/…` rendu par le Worker.
- `Shelf.php:469-475` (`photo_url`) le préfixe par `Settings::get('worker_url')`
  et le pose sur `src`, `full_src`, `thumb_src` et `gallery_thumbnail_src` du
  JSON de variation, **que le navigateur du client reçoit** (`Shelf.php:438-455`).
- La route qui sert ces octets est `worker/falkross.ts:2092-2120`, dans
  `handleFalkRoss`, **avant la porte d'administration**, et elle appelle
  `serveImage` qui va chercher `https://download.falk-ross.eu/ws/{kind}/{file}`.
- `wrangler.jsonc:54-56` route ce préfixe vers le Worker : « sans cela chaque
  photo de coloris était le repli monopage, du HTML en statut 200 ».
- `docs/CATALOGUE.md:117` chiffre le stock : **4 241 photos, 267 Mo, environ
  650 Mo et 34 000 fichiers après redimensionnement**.
- `scripts/wp-catalogue-verify.mjs:546-609` a une assertion qui **exige** que le
  motif de nom de fichier fournisseur n'apparaisse sur une surface client
  qu'à l'intérieur d'une URL `/media/blank/`, et qui prouve les deux sens.

**Conséquence :** supprimer `worker/falkross.ts` en un seul geste transforme
4 241 photos par coloris en 404 sur les 2 309 fiches produit, et le sélecteur de
couleur affiche une image cassée. Ce n'est pas un effet de bord acceptable.

**Ordre imposé :**

1. Le nouveau chemin d'import écrit une valeur pour `META_COLOUR_PHOTO` qui ne
   dépend plus du Worker (téléchargement en pièce jointe, ou relais servi par
   WordPress). Voir 4.5 pour les deux options et leur coût mesuré.
2. Une passe de réécriture des lignes `_teeshoop_colour_photo` existantes, ou une
   réimportation complète, **mesurée** : compter les lignes avant et après.
3. Seulement là, supprimer `PHOTO_ALIAS`, `serveImage`, la route de
   `worker/index.ts` et l'entrée de `wrangler.jsonc`.

Tant que 1 et 2 ne sont pas faits, la route photo reste, même si tout le reste
de `falkross.ts` est parti. Elle est isolable : `serveImage` (lignes 1965 à
2000), `ALLOWED_MEDIA` (ligne 109), `DOWNLOAD` (ligne 84), `fetchUpstream`
(lignes 221 à 253) et la branche `PHOTO_ALIAS` de `handleFalkRoss` (lignes 2092
à 2120). Environ 120 lignes, sans aucune dépendance à `xml.ts` ni à
l'authentification. **C'est le seul morceau de ce
fichier qui a le droit de survivre à sa suppression, et il doit sortir dans un
fichier à lui pour que sa date de mort soit visible.**

### 6.2 `_teeshoop_sizespec` : un champ écrit et jamais lu

`Importer.php:534` écrit `Catalogue::META_SIZESPEC` avec l'URL
`/media/blank/sizespecs/…`. Vérifié : `grep -rn "META_SIZESPEC"` sur tout le
greffon ne rend que la définition (`Catalogue.php:251`) et cette écriture.
**Aucun lecteur.** Sa disparition ne casse rien, et le champ peut être supprimé
en même temps, ce qui évite d'avoir à le migrer en 6.1.

---

## 7. Les secrets, en une passe

### 7.1 Ce qui meurt

| Secret | Où il vit | Ce qui l'utilise | Meurt quand |
|---|---|---|---|
| `FR_WS_USER` | Worker, `.dev.vars` | `worker/falkross.ts:164`, `scripts/fr-verify.mjs:57`, `scripts/purchase-bench.mjs:85` | Suppression de `falkross.ts`. Aiguille conservée dans les deux gardes. |
| `FR_WS_PASS` | Worker, `.dev.vars` | `worker/falkross.ts:165` et les deux mêmes scripts | Idem. |
| `FR_CUSTOMER_NR` | **jamais posé** | `worker/falkross.ts:1797` et `:2285` | Immédiatement. Il n'a jamais existé : `ACCES-REQUIS.md:491` le confirme (« vérifié le 12/08, c'est bien le cas »). Le seul verrou qui bloquait l'achat depuis la séance 08 disparaît **avec la route qu'il bloquait**, pas parce qu'il a été obtenu. À dire clairement à l'associé, sinon la question a l'air résolue. |
| `FR_ORDER_TOKEN` | Worker (posé le 01/09), `~/.config/teeshoop/worker.env` | `worker/falkross.ts:2043`, `.github/workflows/ci.yml:736`, `scripts/wp-secrets.sh:64` et `:114` | **Pas tout de suite.** Il garde `POST /api/fr/order`. Il meurt avec la réécriture de `Supply::place_order()`, section 9. |
| `TEESHOOP_CATALOGUE_TOKEN` | `wp-config.php` des deux boutiques | `Supply.php:126`, `scripts/wp-secrets.sh:112`, `scripts/wp-catalogue-verify.mjs:265` | Avec la réécriture de `Supply.php` : la boutique n'appellera plus le Worker pour le catalogue. |
| `TEESHOOP_ORDER_TOKEN` | `wp-config.php` | `Supply.php:502`, `scripts/wp-secrets.sh:114` | Idem, avec `place_order`. |

**À ne surtout pas supprimer**, vérifié : `ADMIN_TOKEN` (il garde `/api/nest`,
`/api/design/reap`, la suppression RGPD et `/admin*`) et `TEESHOOP_WORKER_TOKEN`
(`Nest.php:58`, `Privacy.php:1176`, `CostAdmin.php:495`, deux suites
d'intégration). Ni l'un ni l'autre n'a de rapport avec le fournisseur.

### 7.2 Ce qui les remplace

Cinq constantes `wp-config.php`, toutes déjà lues par `SupplyHttp.php`, aucune
encore posée nulle part (vérifié : `grep -rn "TEESHOOP_SUPPLY"` ne rend que
`SupplyHttp.php`) :

| Constante | Lue en | Sans elle |
|---|---|---|
| `TEESHOOP_SUPPLY_BASE` | `SupplyHttp.php:130` | `unconfigured()` rend une phrase française, aucun appel ne part. |
| `TEESHOOP_SUPPLY_TOKEN` | `SupplyHttp.php:144` | Idem. La valeur est **l'en-tête complet**, préfixe `Bearer ` compris. |
| `TEESHOOP_SUPPLY_V2_BASE` | `SupplyHttp.php:153` | `live_unconfigured()` refuse le service prix/stock, séparément du catalogue. |
| `TEESHOOP_SUPPLY_CLIENT_ID` | `SupplyHttp.php:473` | Idem. |
| `TEESHOOP_SUPPLY_CLIENT_SECRET` | `SupplyHttp.php:474` | Idem. |
| `TEESHOOP_SUPPLY_MEDIA_BASE` | `SupplyHttp.php:166` | Les URL de photos sont rendues telles quelles, donc en 404 : mesuré le 9 septembre, huit URL sur huit répondent 404 sur l'hôte du service et 200 sur l'hôte public. |

Elles se posent par `wp config set NOM valeur --type=constant`, jamais par la
transcription. `scripts/wp-secrets.sh` doit gagner les six lignes correspondantes
et perdre `TEESHOOP_CATALOGUE_TOKEN` et `TEESHOOP_ORDER_TOKEN` au moment où
`Supply.php` est réécrit. **Rappel de `ACCES-REQUIS.md:1198` : `wp config set`
affiche la valeur qu'il vient d'écrire.**

`ACCES-REQUIS.md` se met à jour en une passe : ligne 17 du tableau d'état,
lignes 65 et 66, la section 5 entière (472 à 560), les tableaux 1110 et 1185.

---

## 8. L'ordre d'exécution, et la porte qui doit tomber en rouge

Un ordre, six commits, et **une garde à faire échouer volontairement à chaque
étape** avant de la remettre au vert, comme l'exige `CLAUDE.md` section 1.

| # | Ce qu'on fait | La porte qui doit tomber si on se trompe |
|---|---|---|
| 1 | `docs/hypotheses.json` : `H-Q09-FAMILLES`, champ `mirrors[0].ref`. **Mesuré** : `scripts/hypotheses-guard.mjs:532` fait `if (!existsSync(abs)) return { ok: false, why: 'no such file' }`. Supprimer `worker/falkross.ts` sans traiter cette entrée fait échouer `npm run verify:hypotheses`, qui est dans `npm run ci`. Le miroir doit pointer vers l'endroit qui décidera désormais ce qui est imprimable, ou l'entrée doit dire que la règle n'a plus qu'une maison. | `npm run verify:hypotheses` |
| 2 | Isoler la route photo dans son propre fichier (6.1), sans rien changer d'autre. Le Worker sert les mêmes octets sur les mêmes URL. | `npm run verify:wp-catalogue` contre le miroir garni, assertions `/media/blank/` |
| 3 | Studio : `CatalogModal.tsx`, `catalogI18n.ts`, `falkross.ts`, `frCache.ts`, `admin-boundary.mjs`. | `npm run typecheck`, `npm test` (`src/app/adminBoundary.test.ts`), `npm run verify:bundle` |
| 4 | Worker : `falkross.ts`, `falkross.test.ts`, les fixtures, `xml.ts`, `tsconfig.json`, `index.ts`, `cors.test.ts`, `cors-verify.mjs`. **Le remplaçant du test de classement (4.7) est dans ce commit ou le commit n'est pas fait.** | `npm run typecheck:worker`, `npm test`, `npm run verify:cors` |
| 5 | Scripts et configuration : `fr-verify.mjs`, `purchase-bench.mjs`, `catalog-verify.mjs`, `package.json`, `wrangler.jsonc`, `.dev.vars`, `.gitignore`, `ci.yml`, `php-guard.mjs`, `bundle-guard.mjs`. | `npm run verify:php --self-test`, `npm run verify:bundle -- --dist <build d'avant>` |
| 6 | Documentation, en un seul commit éditorial séparé. | `npm run verify:style` |

`npm run ci` en entier à la fin. Les trois harnais qui ne sont pas dans la CI et
qui couvrent ce changement (`verify:wp-catalogue`, `verify:vitrine`,
`verify:cache`) tournent à la main contre le miroir docker garni, et leur sortie
va dans la transcription.

---

## 9. Ce que ce plan ne tranche pas

Cinq points sortent du périmètre d'une suppression et doivent être décidés avant
que la réécriture commence.

1. **`Supply.php` est réécrit séparément.** Aujourd'hui il parle au Worker
   (`ROUTE = '/api/fr/'`, ligne 56, `base()` = `Settings::get('worker_url')`,
   ligne 114). Demain il parlera au fournisseur par `SupplyHttp`. Ce qui doit
   traverser sans perte : `SOURCE = 'ws'` (ligne 71, un code d'adaptateur et
   jamais un nom), `references()` avec son `complete` et son `dropped` (4.4),
   `entry()` avec la forme de charge utile de 4.1, la discipline d'horodatage de
   4.3 et le `place_order` de 4.9. **L'exemption de ce fichier dans
   `php-guard.mjs` disparaît** : sans littéral `/api/fr/`, il n'en a plus besoin.

2. **La latence est la contrainte centrale, et elle change l'architecture.**
   Mesurée sur sept points, linéaire : 0,43 s de socle et 0,068 s par code,
   10,7 s pour un lot plein de 150, 15,6 s pour une référence à 228
   déclinaisons. `price-stock` est la **seule** source complète et à jour. Un
   catalogue de 2 300 références ne peut donc pas être rafraîchi
   synchroniquement, et une fiche produit ne peut pas l'appeler au rendu. Le
   modèle « la boutique appelle le Worker qui a un cache » disparaît avec le
   Worker : il faut décider ce qui le remplace (une file WordPress, un cron plus
   fréquent, un cache en base) et le mesurer, pas le supposer.

3. **Où va le classement en rayons.** Il était dans le Worker parce que le Worker
   lisait le XML. Le nouveau service rend du JSON à PHP. Le classificateur peut
   descendre dans le greffon, mais `php-guard.mjs` y interdit tout nom de
   fournisseur, et un tableau de libellés fournisseur est très exactement ça.
   `Supply::SOURCE = 'ws'` montre la sortie (un code, pas un nom) mais la
   question du vocabulaire reste ouverte.

4. **`SizeOverride` : à trancher sur une mesure, pas d'avance.** L'éditeur de
   mesures par taille (`CatalogModal.tsx:104-173`) existe parce que Falk & Ross
   ne publie aucune mesure (`types.ts:104-113`). L'extrait Imbretex hors ligne en
   publie. **Si l'API du nouveau fournisseur n'en publie pas**, `SizeOverride` et
   `SizeSource = 'reference-chart'` restent nécessaires et le supprimer coûterait
   la seule façon qu'a un opérateur de corriger une estimation. Regarder la
   charge utile réelle avant de supprimer ces 70 lignes.

5. **L'aiguille des annonces de fin de série** (4.10) ne peut pas être devinée.
   Il faut lire une description de fin de série réelle chez le nouveau
   fournisseur et prendre la chaîne telle quelle, sinon le contrôle de
   `wp-catalogue-verify.mjs` reste vert en ne cherchant rien.

---

*Écrit le 9 septembre 2026. Toutes les affirmations de ce document ont été
vérifiées par `grep` ou par lecture du fichier cité. Les chiffres de latence, de
pagination et de complétude de l'API sont ceux mesurés le même jour contre le
service de préproduction.*
