# 5 septembre 2026 : le personnalisateur quitte le cadre et remonte dans la fiche produit

Ce document dit ce qui a été démonté, ce qui l'a remplacé, ce qui a été mesuré,
et ce qui n'a pas été fait cette nuit avec la raison chiffrée de chaque manque.

Il existe parce que `includes/Shortcode.php` défendait l'encadrement du studio
avec six raisons techniques précises, et que **les six étaient vraies**. Elles
n'ont pas été balayées : elles ont été relues une par une, et ce qui manquait
dans le raisonnement d'origine est écrit en tête de section 2.

---

## 1. Ce que l'encadrement coûtait, mesuré

Le studio est une application React servie en croisé par un Worker Cloudflare et
encadrée dans la fiche produit. Relevé le 5 septembre 2026 :

| | Avant | Après |
|---|---|---|
| Le personnalisateur ouvre sur le produit cliqué | **non** | **oui** |
| Charge immédiate, compressée | 246 473 o | **113 809 o** (46,2 %) |
| Origine du personnalisateur | `tshop.abdellah-latreche04.workers.dev` | la boutique |
| Stockage des fichiers du client | tiers, partitionné | même origine |
| Le Worker tombe : la fiche dit quelque chose | **non** | **oui** |
| Moteurs de prix atteignables par un client | **2** | **1** |
| Question « combien, quelles tailles » posée | **deux fois** | **une fois** |

Les trois lignes qui ne sont pas des chiffres méritent d'être détaillées.

**Le cadre n'ouvrait pas sur le produit cliqué.** Il restaurait le dernier
brouillon du visiteur, ou chargeait `makeSampleDesign()`, un t-shirt noir portant
« TSHOP » en arche. Un client qui cliquait « Personnaliser » sur un sweat voyait
le vêtement de quelqu'un d'autre, travaillait dessus, et s'entendait dire au
dernier clic que cette page vendait autre chose. Le `garment` que le pont
envoyait ne servait qu'à décider si un bouton panier avait le droit d'apparaître.

**Le stockage était partitionné.** La création et les rasters du client vivaient
dans l'IndexedDB d'une origine tierce, que les navigateurs cloisonnent par site
encadrant depuis 2022 et qu'un rechargement de page peut effacer.

**Une panne du Worker était muette.** `assets/bridge.js` attachait un écouteur
`load` et n'avait aucun chemin d'erreur : Worker en panne, cadre vide, page
silencieuse, et plus aucun produit personnalisable achetable.

Le poids n'a jamais été l'argument. Le studio pesait 246 473 octets compressés
contre 322 662 pour Fancy Product Designer que la production charge déjà sur
chaque fiche, et 574 129 pour le studio de mistertee. L'argument est que les deux
concurrents servent leur personnalisateur en **même origine** (tostadora
`/design-tool/`, mistertee `/teezigner`, zéro cadre), qu'un cadre tiers casse le
stockage du client, et qu'une panne du Worker tuait toutes les ventes sans un mot.

---

## 2. Les six raisons, et ce qui leur manquait

Le raisonnement d'origine était juste sur les faits et faux sur la conclusion :
les six raisons décrivent une propriété de **cette application-là**, pas une
propriété de l'idée d'un personnalisateur intégré. On a défendu l'encadrement au
lieu de se demander si l'application était la bonne chose à encadrer.

Chaque réponse est écrite **à côté de la raison** dans `src/native/main.ts`, et
chacune a une garde dans `scripts/editeur-guard.mjs` :

| Raison | Réponse | Garde |
|---|---|---|
| 1. La remise à zéro non préfixée de Tailwind v4 réécrit `a`, `h1`–`h6`, `button`, `img` du thème | Pas de Tailwind. `editeur.css` n'a aucun sélecteur d'élément nu ; tout est sous `.tshop-ed` | « chaque sélecteur commence par .tshop-ed » |
| 2. `body{overflow:hidden}` et `100dvh` tuent le défilement du site | L'éditeur est un bloc dans le flux ; le canevas suit son conteneur par `ResizeObserver` | « aucune règle ne sort de sa portée vers body, html ou :root » |
| 3. ~53 Mo d'actifs en chemins absolus | La vue simple n'en référence aucun ; le vêtement est dessiné, la zone calculée, la photographie fournie par WordPress | trois marqueurs (`/models/`, `/ort/`, `/catalog/`) cherchés dans le paquet construit |
| 4. Les fenêtres `position:fixed` entrent en collision avec Elementor | Aucune fenêtre dans la vue simple | « aucune fenêtre en position: fixed » |
| 5. Trois écouteurs clavier globaux avalent les frappes | L'écouteur est sur le conteneur, qui porte `tabindex` | `window`/`document.addEventListener("key…")` cherché dans la sortie |
| 6. Les singletons de niveau module n'autorisent qu'une instance | Tout l'état est dans l'instance | aucun `let`/`var` de niveau module dans `src/native/` |

Sur la sixième, ce qui **reste** partagé est nommé plutôt que nié, parce qu'une
réponse qui prétend à zéro état partagé serait fausse :

- le cache de dépôt (`src/lib/teeshoop/upload.ts`), clé par le CONTENU et par
  l'adresse du Worker : deux éditeurs qui déposent la même création partagent une
  requête au lieu d'en payer deux, ce qui est voulu ;
- le nuancier mesuré (`setShopPalette`), qui est de la configuration de
  **document** : une fiche produit vend un article. C'est pour ça que
  `src/native/main.ts` n'en monte qu'un par page, comme `Shortcode::$rendered`
  avant lui, et marque le second au lieu de l'effacer.

---

## 3. Ce qui n'est pas réécrit, et c'est le plus important

Le paquet natif **importe** et ne recopie pas :

- `src/lib/ink.ts`, la seule mesure d'encre, celle que lisent le coût du film ET
  le prix client ;
- `src/editor/EditorEngine.ts`, le seul tracé, avec les mêmes fonctions de dessin
  que l'export DTF, donc ce qu'on édite est ce qui s'imprime ;
- `measureOrder` et `uploadDesign`, la seule dérivation des faces et le seul
  dépôt ;
- `Pricing.php`, le seul prix.

Une seconde implémentation de l'une d'elles serait exactement la faute que
`CLAUDE.md` section 1 nomme. `scripts/editeur-guard.mjs` **exige** que ces
modules restent atteignables, dans les deux sens : une « correction »
enthousiaste d'une violation ne peut pas passer en supprimant la mesure d'encre.

L'ordre est préservé mot pour mot : `ensureInkProbes` se stabilise, **puis** le
serveur chiffre, **puis** le fichier part sur R2 et rend un identifiant, **puis**
l'ajout au panier avec le nonce de la page. Le refus d'un devis arrive AVANT le
dépôt, donc avant qu'un client ait attendu le téléversement de son fichier pour
rien.

Ce qui ne change pas non plus : `Cart::add` redérive le vêtement depuis
`Product::garment_of` et les faces imprimées depuis le document que le Worker a
stocké, `Design::verify` échoue fermé, `Rest::check_nonce` exige `x-wp-nonce`
explicitement, et `refuse_plain_add` refuse toujours tout ajout qui ne passe pas
par `Cart::add`. **Un éditeur dans la page n'obtient pas plus de confiance qu'un
éditeur dans un cadre.**

---

## 4. Le seul blocage technique, et pourquoi il fallait le nommer

`POST /api/design` et `GET /api/design/{id}` n'exposaient aucun en-tête CORS. Un
paquet en même origine peut ENVOYER le dépôt (un POST multipart est une requête
simple et part toujours) et le navigateur lui refuse la LECTURE de la réponse,
donc l'identifiant que l'ajout au panier exige. L'achat s'arrête une étape avant
le panier, avec un `TypeError` et rien qui ressemble à un refus.

`worker/cors.ts`, additif, sur ces deux routes et aucune autre : égalité de
chaîne exacte contre `SHOP_ORIGINS`, jamais `*`, jamais `startsWith`, un
gestionnaire `OPTIONS`, identifiants désactivés, `vary: Origin` sur les refus
aussi. `SHOP_ORIGINS` non renseigné refuse tout le monde, à l'inverse de ce que
la même variable fait pour `frame-ancestors` : là-bas la directive est de la
profondeur et le vrai verrou est ailleurs ; ici l'en-tête EST le verrou.

Vérifié contre un vrai `wrangler dev`, **jamais sur le code de statut** :
`assets.not_found_handling` est en mode application monopage, donc toute URL
inconnue rend 200 avec 4 025 octets de HTML, et une sonde sur le statut serait
une porte qui ne peut pas échouer. La première assertion du harnais vérifie que
le repli monopage est bien actif, pour que les suivantes ne mesurent pas des
pages HTML.

---

## 5. Ce qui n'a pas été fait, avec le chiffre de chaque manque

### Le détourage, dans la vue avancée

Mesuré en le construisant : `vite` copie **13 480 ko** de WebAssembly dans le
répertoire du greffon, deux fois, parce qu'`onnxruntime-web` référence son
binaire par `new URL(…, import.meta.url)` et qu'aucune option ne l'en empêche
(`external` sur `.wasm` ne l'attrape pas : ce n'est pas un import, c'est un actif
émis). Avec le modèle ONNX, 4 600 ko, cela fait **18 Mo** qui partiraient en
rsync vers o2switch à chaque déploiement d'un greffon WordPress.

Les servir depuis le Worker marche pour le téléchargement (`connect-src`
autorise déjà cette origine dans `Csp.php`) et demande en plus
`'wasm-unsafe-eval'` dans le `script-src` de la boutique, c'est-à-dire une
modification de sa politique de sécurité. C'est petit, c'est faisable, et ça se
mesure ; ça ne se décide pas à la fin d'une nuit dont le brief dit que le CORS du
Worker est le seul changement d'infrastructure autorisé.

**Ce que le client lit à la place** : « Nous ne savons pas encore enlever le fond
d'une image ici. Envoyez un PNG à fond transparent, ou écrivez-nous : nous
détourons le visuel avant l'impression. » C'est un état vide dessiné, pas un
silence.

### La réalité augmentée

Bloquée par une chose nommable : `uploadArModel` poste sur `POST /api/ar`, qui
n'expose aucun en-tête CORS. Depuis la page de la boutique l'envoi partirait et
la réponse serait illisible. C'est **une ligne** dans `worker/index.ts`, du même
genre que celle qui a été écrite pour `/api/design`, et elle appartient à une
nuit qui a le droit de la faire.

### L'aperçu 3D

Monté par React dans le studio (`src/app/Scene3D.tsx`). Le porter est un vrai
poste : three.js, la scène, les textures, la caméra. Le faire à moitié
produirait une SECONDE implémentation du rendu du vêtement.

Aucun des trois n'est sur le chemin d'un achat : un client qui n'ouvre jamais la
vue avancée achète exactement comme avant, et un qui l'ouvre y trouve les quatre
autres postes (dos et manches, plusieurs calques, texte et polices, alignement au
centimètre).

---

## 6. Le contrat de retour, tenu

1. Le commit qui retire le chemin iframe est **postérieur** à celui dont le test
   d'ajout au panier de bout en bout est vert contre un vrai WooCommerce.
   Vérifiable dans `git log`.
2. `npm run verify:vendable` va chercher une fiche produit et affirme qu'un
   chemin d'achat fonctionnel existe. Il compte l'éditeur natif monté avec son
   bouton offert, ou le studio encadré ; il ne compte pas le devis, qui est un
   formulaire et pas une caisse. Avec `--retablir` il éteint le drapeau et, si le
   cadre a disparu du code, annule le commit qui l'a retiré.
3. Le basculement est un drapeau (`Settings`, `editeur_natif`), faux par défaut
   jusqu'à ce que le test soit vert.

Preuve que la porte 2 peut échouer : les deux chemins ont été cassés exprès (le
paquet construit retiré et `studio_origin` vidé) et le script a d'abord dit
« vend » à tort, parce qu'il comptait l'ancre « Personnaliser » sans regarder où
elle menait. Il suit maintenant le lien ; corrigé, il dit « NON, par rien ».

---

## 7. Ce qu'il reste à décider, et par qui

- **La photographie par coloris.** Voir
  `2026-09-05-la-zone-dessinee-et-la-photographie.md` : la boutique n'a qu'une
  photographie par référence pour 54 coloris.
- **`'wasm-unsafe-eval'` dans le `script-src` de la boutique**, si le détourage
  doit revenir en ligne. Décision du développeur.
- **Le CORS de `POST /api/ar`**, si la réalité augmentée doit être offerte depuis
  la fiche produit.
