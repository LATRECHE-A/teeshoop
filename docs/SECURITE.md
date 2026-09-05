# La passe de sécurité de la séance 13

> 27 et 28 août 2026. Modèle d'attaquant : quelqu'un de compétent, avec un
> navigateur, notre JavaScript public, et aucun identifiant.
>
> Ce document dit ce qui a été essayé, ce qui a tenu, ce qui n'a pas tenu, et ce
> qui reste ouvert. **La liste de ce qui a tenu est la moitié la plus utile** :
> une passe qui ne publie que ses trouvailles ne dit pas si elle a regardé.

---

## 1. Comment elle a été menée

Six surfaces, nommées par le brief de la séance, chacune relue par un lecteur
indépendant qui ne voyait que la sienne, puis chaque trouvaille soumise à un
sceptique dont le travail était de la **réfuter**. Ensuite, et c'est le point qui
compte, **les trouvailles retenues ont été rejouées à la main contre un vrai
Worker** : une attaque décrite n'est pas une attaque, et deux de celles retenues
ici n'auraient pas survécu à une reproduction si elles avaient été fausses.

| Surface | Attaques repoussées | Trouvailles confirmées |
|---|---:|---:|
| Le pont postMessage | 15 | 0 |
| Le nonce REST et le panier | 11 | 1 |
| Les routes ouvertes du Worker | 14 | 2 |
| Les lectures R2 | 13 | 2 |
| Le portail d'administration | 13 | 0 |
| Ce qui part dans le paquet client | 9 | 1 |

Deux réfutations ont été retenues comme telles et ne figurent pas comme
trouvailles : la clé WooCommerce de l'atelier dans le `localStorage` (aucune
séquence d'attaque, il faut déjà exécuter du script sur cette origine) et une
première formulation de la fuite des morceaux d'administration dont le mécanisme
était juste et l'impact mal décrit. La seconde a été retrouvée autrement et est
au point 2.3.

---

## 2. Ce qui n'a pas tenu, et ce qui a été fait

### 2.1 La surface d'encre facturée est déclarée par l'acheteur (corrigé en partie)

`POST /api/design` est ouverte : le client est l'auteur de sa création et ne peut
pas s'authentifier. Un acheteur dessinait un plein devant réel, interceptait le
`multipart` que le studio s'apprêtait à envoyer, et changeait **un seul nombre** :
`sides[0].area_sq_cm`, de ~950 à 1. Tout le reste restait vrai. Le document était
accepté, stocké, confirmé par `Design::verify`, et `Cart.php` prenait les faces
**depuis la création stockée**, exactement comme il doit. `Pricing::area_tier()`
facturait alors le palier le plus bas pour une impression pressée à sa taille
réelle : jusqu'à 9,00 EUR HT par face imprimée et par vêtement.

Rien ne l'attrapait parce que le contrôle existant est **unidirectionnel** :
`readPieces` refuse des rectangles trop PETITS pour l'encre annoncée, ce qui
sous-estimerait le film. Personne n'avait écrit l'autre moitié.

**Corrigé** par un plancher dérivé, pas par une tolérance : un transfert est la
boîte d'encre d'un groupe agrandie du débord sur les quatre côtés puis rognée à
la zone d'impression, donc l'encre derrière lui vaut au moins le rectangle moins
deux débords, et la surface déclarée est l'**union** de ces boîtes, donc au moins
la plus grande. Le détail, y compris pourquoi c'est la plus grande et non la
somme, est dans `src/lib/teeshoop/designDoc.ts`.

**Ce que cela ne ferme pas**, dit ici plutôt que laissé à découvrir : un document
qui rétrécit les rectangles ET la surface ensemble reste cohérent avec lui-même,
et l'atelier remesure la vraie création quand il monte une planche
(`src/lib/dtf/pieces.ts`), donc la vraie impression est pressée dans les deux
cas. Le fermer demande de comparer cette remesure avec ce qui a été facturé : une
modification de `Production.php` et du constructeur de planches. Voir le point 4.

### 2.2 Les deux routes ouvertes étaient de l'hébergement de fichiers (corrigé)

Reproduit contre un vrai `wrangler dev` :

    printf '\x89PNG\r\n\x1a\n' > fake.png ; head -c 300000 /dev/urandom >> fake.png
    curl -F design=@doc.json -F preview=@fake.png .../api/design
      -> 200, puis GET /r2/design/<id>/preview.png rend les 300 008 octets
         identiques, en image/png, cache-control public max-age=31536000 immutable

    printf 'glTF' > fake.glb ; head -c 50000 /dev/urandom >> fake.glb
    zip -j fake.usdz payload.txt
    curl -F glb=@fake.glb -F usdz=@fake.usdz -F poster=@fake.png .../api/ar
      -> 200, puis unzip -l /r2/ar/<id>.usdz liste payload.txt

teeshoop.com était donc un hébergement gratuit, permanent, immuable et non
authentifié pour des octets arbitraires, à des URL en `.png` et `.usdz` d'allure
anodine, sur l'origine qui sert aussi la boutique et `/admin.html`.

**Corrigé** : `worker/containers.ts` parcourt l'arithmétique de longueur propre à
chaque format et exige qu'elle se referme exactement sur le dernier octet du
fichier. Les deux attaques ci-dessus répondent maintenant 415, et une vraie
capture PNG de 160 ko passe toujours.

### 2.3 Fermer la page d'administration ne fermait que la page (corrigé)

Mesuré contre un vrai Worker :

    GET /admin.html                    401
    GET /assets/DtfModal-<hash>.js     200, 137 082 octets, sans identifiants
    GET /.vite/manifest.json           200, 57 104 octets, nommant chaque morceau

Le deuxième est le modèle de coût du film. Le troisième explique pourquoi le
condensat dans le nom n'a jamais été un obstacle. **Les deux garde-fous prévus
pour cela étaient verts et aucun n'avait tort** : l'un prouve que l'entrée client
ne peut pas ATTEINDRE ces modules, l'autre autorise justement le vocabulaire
interne dans un fichier classé ADMIN. Aucun n'affirmait qu'un fichier ADMIN n'est
pas simplement téléchargeable, alors que la règle du projet est que tout ce qui
est joignable par URL est public.

**Corrigé** : les morceaux que seule l'entrée d'administration atteint sont émis
dans `admin-assets/`, que le Worker refuse sans les mêmes identifiants.
`npm run verify:admin-gate` le vérifie dans un vrai navigateur, y compris le
point que le papier ne tranchait pas : le packeur de planches est un **worker de
module**, et le navigateur joint bien ses identifiants à cette requête.

### 2.4 Le manifeste Vite rendait aveugle le garde-fou (corrigé)

Trouvé en poursuivant le point précédent, et c'est le plus discret des cinq.
`bundle-guard.mjs` ferme son ensemble atteignable sur les mentions de noms de
fichiers, et `DtfModal-<hash>.js` contient la chaîne `manifest.json` parce qu'il
lit un manifeste de CRÉATION dans R2. Le manifeste de build était donc aspiré
dans la fermeture ADMIN par une sous-chaîne accidentelle, et comme il nomme tous
les fichiers émis, tout le reste suivait. Or **un fichier ADMIN est dispensé du
balayage de vocabulaire**. Un morceau réellement orphelin portant un prix d'achat
aurait été classé ADMIN et jamais lu.

Mesuré avant : 39 fichiers, 28 client, 11 ADMIN, 0 orphelin, dont 9 vrais.
Après : 38 fichiers, 28 client, 1 visionneuse, 9 ADMIN, 0 orphelin.

---

## 3. Ce qui a été essayé et a tenu

75 attaques, avec le mécanisme exact qui les arrête. Résumé par surface ; les
lignes citées sont dans le dépôt.


> **CETTE SECTION DÉCRIT UN PONT QUI N'EXISTE PLUS (5 septembre 2026).**
>
> Le studio encadré, `Shortcode.php` et `assets/bridge.js` sont supprimés :
> l'éditeur est dans la fiche produit, servi par la boutique, et il n'y a plus
> de `postMessage`, plus de comparaison d'origine côté page, plus de table de
> messages. Les analyses ci-dessous restent écrites parce qu'elles disent
> POURQUOI chaque contrôle existait, et deux d'entre elles ont survécu au
> changement : le nonce REST exigé explicitement, et le fait qu'aucun prix ni
> aucune surface ne décide quoi que ce soit depuis la requête.
>
> La surface d'aujourd'hui est décrite dans
> `docs/decisions/2026-09-05-le-personnalisateur-est-dans-la-page.md` et dans
> `.claude/skills/security/SKILL.md` : le nonce reste sur la page et n'atteint
> qu'une route, tout ce que `wp_localize_script` publie est relu par
> `src/native/contexte.ts`, et le dépôt de la création est le seul appel
> inter-origines, autorisé par `worker/cors.ts` en égalité de chaîne exacte.
>
> Ce que le cadre achetait et qui est perdu : il isolait la création du client
> des autres scripts de la page. Ce n'est plus le cas. Le rayon d'action d'une
> extension compromise sur une fiche produit est plus large qu'avant.

### 3.1 Le pont postMessage (15)

La règle du projet est `event.origin === attendu`, jamais `startsWith`, jamais
`postMessage(…, '*')`, et le nonce REST ne franchit pas la frontière d'origine.
Les trois tiennent, partout, y compris sur les chemins d'erreur.

- Une page attaquante qui encadre le studio et forge la poignée de main : refusée
  par une appartenance à une liste, chaîne entière, pas un préfixe
  (`src/lib/teeshoop/bridge.ts:450`). L'offre sortante ne fuit pas non plus, elle
  est postée avec une origine cible explicite par entrée autorisée.
- Une page attaquante qui parle au parent en se faisant passer pour le studio :
  `event.source !== frame.contentWindow` (`assets/bridge.js:47`). `event.source`
  est posé par le navigateur et ne se forge pas.
- **La bonne attaque, celle qui aurait marché avec un `startsWith`** : encadrer
  la page produit, puis, en tant qu'ancêtre, renavigate l'iframe vers
  `https://evil.tld/faux-studio`. `contentWindow` est le même WindowProxy après
  navigation, donc le contrôle de `source` passe. C'est le contrôle d'origine en
  `!==` contre une valeur normalisée serveur qui refuse (`assets/bridge.js:44`).
- La même chose pointée sur une URL de l'origine du studio dont l'attaquant
  contrôle les octets : **il n'existe pas de telle URL**. Le type stocké est
  imposé à l'écriture, jamais celui du client, et la lecture n'expose que quatre
  formes de noms.
- Fixer son propre prix par le message d'ajout au panier : aucun prix ne traverse
  la frontière. Le vêtement vient de `Product::garment_of`, les faces imprimées
  du manifeste vérifié, pas de la requête.
- Voler le nonce REST : il n'est que dans l'objet même-origine, utilisé seulement
  comme en-tête `X-WP-Nonce`, et aucun gestionnaire ne le renvoie.
- Faire naviguer le parent : il n'y a pas de gestionnaire de navigation. La table
  a exactement quatre entrées.
- Pousser les commandes de la page hors de l'écran par une hauteur d'iframe
  démesurée : bornée à 320-4000 px puis re-bornée à la hauteur de la fenêtre.
- Un second écouteur `message` plus laxiste ailleurs : il n'y en a que deux dans
  tout le dépôt, et une seule iframe est rendue sur tout le site.
- Une chaîne de prototypes via `HANDLERS[data.type]` : atteignable en principe,
  inerte en pratique, et de toute façon derrière les deux contrôles ci-dessus.

### 3.2 Le nonce REST et le panier (11)

- Poster un prix : **il n'existe aucune clé de prix**. La charge est construite à
  partir de six clés nommées (`Rest.php:256`).
- Nommer un vêtement bon marché (`custom`, base 0,00 EUR) sur une page qui vend un
  sweat : refusé en 409 plutôt que corrigé (`Cart.php:230`).
- Un POST inter-site vers `/wp-json/teeshoop/v1/cart` avec `_wpnonce` dans le
  corps, que le contrôle de WordPress accepterait : `check_nonce` ne lit le nonce
  **que** dans l'en-tête (`Rest.php:118`). Un formulaire ne pose pas d'en-tête.
- Le même en `fetch` : l'identité du panier est le cookie de session, qui n'est
  pas envoyé en inter-site sous le `SameSite=Lax` par défaut.
- Atteindre les routes d'atelier (noms de clients, économie du film, coût par
  commande) : toutes derrière `current_user_can` (`Production.php:1656`).
- Traiter une panne du Worker comme un feu vert : un id malformé, une URL non
  configurée, une erreur réseau, un non-200 et un JSON illisible renvoient tous
  `ok => false` (`Design.php:61`). « On n'a pas pu demander » n'est pas « ça
  existe ».
- Acheter au plafond en envoyant une grille de tailles qui dépasse `max_qty` :
  refusé en 400 plutôt que rogné.
- Mettre une URL choisie dans la vignette du panier ou du bon a tirer : seules
  deux formes exactes sont acceptées (`Design.php:177`).
- Piloter le prix par une surface absurde ou non finie : NAN et INF tombent, le
  reste est plafonné.

### 3.3 Les routes ouvertes du Worker (14)

- Injection de chemin de clé par le nom d'une pièce (`asset:../../ar/victime`) :
  refusée par des expressions rationnelles ancrées, appliquées avant que l'id
  n'atteigne la construction de clé.
- Un échappement `%zz` malformé pour transformer une route ouverte en 500 :
  `decodeSegment` est enveloppé, et le null est répondu en 404.
- Multiplier le nombre d'écritures R2 en répétant une petite pièce : le contrôle
  de doublon existe **parce que cela a été exploitable** (5 003 écritures depuis
  une requête).
- Lire la création d'un autre client avec son seul identifiant : tout ce qui
  n'est pas un aperçu passe par le portail admin avant la lecture du seau.
- Deviner un identifiant : 24 caractères sur un alphabet de 62 tirés de
  `crypto.getRandomValues`. Le biais de modulo est réel et coûte 0,05 bit par
  caractère, ce qui laisse 142,8 bits au lieu de 142,9.
- Choisir le type stocké pour transformer un aperçu en XSS stockée : le type
  déclaré par le client n'est jamais utilisé.
- SSRF : aucune des deux routes ne déréférence une chaîne de l'attaquant. Il n'y
  a pas de `fetch()` dans `worker/design.ts`.
- Pollution de prototype par une face nommée `__proto__` : `Object.fromEntries`
  et `JSON.parse` définissent une propriété propre, pas via le mutateur.
- Atteindre les routes destructrices depuis un navigateur qui porte déjà les
  identifiants Basic de l'opérateur : elles exigent **spécifiquement** la forme
  `Bearer`, qu'un formulaire ne peut pas poser.

### 3.4 Les lectures R2 (13)

- HEAD au lieu de GET pour contourner le portail : les deux entrent dans le même
  gestionnaire, et le portail est avant la lecture.
- Distinguer un 401 d'un 404 pour énumérer : le portail est **avant** la lecture,
  donc tout chemin non-aperçu répond 401 que l'objet existe ou non.
- Confusion de préfixe entre `ar/` et `design/` : les expressions rationnelles
  n'admettent ni `/` ni `.`.
- Une requête Range pour tirer un objet privé : la moitié `design` ignore Range
  entièrement.
- Lire le cache des charges dérivées Falk&Ross, qui porte nos prix d'achat, comme
  `/__fr-cache/` l'a été : les clés sont frappées sur un hôte que nous ne servons
  jamais, et le préfixe est refusé explicitement.
- Transformer les deux routes photo non gardées en proxy ouvert : répertoire sur
  liste blanche et nom de fichier sans `/` ni `%`.
- Récolter des URL d'aperçu par le `Referer` des images du bon a tirer :
  `Referrer-Policy: no-referrer` est posé sur ce document.
- Lire une réponse privée dans un cache partagé : `private, no-store` pour le
  document et les rasters, `private` plus `vary: authorization` côté fournisseur.

### 3.5 Le portail d'administration (13)

**La route qui dépense de l'argent** a été regardée en premier, comme le brief le
demandait. `POST /api/fr/order` exige `ADMIN_TOKEN` **et** `FR_ORDER_TOKEN` sur
son propre en-tête, et **refuse la forme Basic spécifiquement**
(`falkross.ts:1841`) : un navigateur qui a répondu à la boîte de connexion la
rejoue toute seule, donc un POST inter-site depuis une page attaquante enverrait
`Basic` et n'atteint rien. Vérifié aussi pour les deux routes de suppression.

- Traversée par l'exemption `img/` (`/api/fr/img/../price/18001`, et sa variante
  `%2e%2e`) : l'analyseur d'URL du standard normalise les deux avant le test.
- Une méthode que le portail ne couvre pas (HEAD, OPTIONS) : le portail est
  agnostique de la méthode et se trouve au-dessus de tout test de méthode.
- Une réponse authentifiée rangée dans un cache partagé : jamais `public`,
  toujours `vary: authorization`.
- Lire une réponse gardée en inter-origine avec les identifiants ambiants : le
  seul `access-control-allow-origin` du Worker est sur le proxy photo public.
- Contourner le portail en demandant `/admin/` ou `/%61dmin.html` : la couche de
  ressources décode puis re-encode et redirige vers la forme canonique, qui est
  bien routée vers le Worker.
- Ouvrir en grand un Worker déployé avant `wrangler secret put` : un `ADMIN_TOKEN`
  absent ou plus court que 24 caractères refuse tout. L'inversion tentante
  `if (!token) return null` est absente.
- Distinguer « pas de jeton configuré » de « mauvais jeton » : corps et statut
  identiques à l'octet près.
- Atteindre la route qui dépense par la boutique plutôt que par le Worker : le
  seul appelant non-test commence par `current_user_can`.

### 3.6 Ce qui part dans le paquet client (9)

- Du vocabulaire interne atteignant un morceau client par un baril, une
  ré-exportation, un fichier i18n ou un import paresseux : vérifié indépendamment
  sur le `dist/` construit.
- Lire le paquet d'administration par une carte de sources : aucune n'est émise.
- Extraire le jeton admin ou les identifiants fournisseur du JavaScript livré :
  le jeton n'est qu'en `sessionStorage` et la branche de développement disparaît
  à la compilation.
- L'instantané fournisseur servi en clair : ce sont des prix de vente conseillés
  publiés par le fournisseur, pas nos prix d'achat, et le fichier le dit dans son
  propre texte. Il est désormais **balayé** par le garde-fou, contrairement à tout
  autre fichier classé ADMIN, précisément parce qu'il reste en clair.

---

## 4. Ce qui reste ouvert

1. **Le document de création cohérent mais rétréci** (point 2.1). Fermeture :
   comparer la remesure faite par l'atelier avec ce qui a été facturé. C'est une
   détection après paiement, pas une prévention, et c'est le seul chemin possible
   parce que le serveur ne peut pas mesurer de l'encre.
2. **Aucune limitation de débit sur les deux routes ouvertes.** Elles écrivent
   dans R2 et R2 coûte. Une requête peut encore écrire jusqu'à la limite par
   requête, et rien ne borne le nombre de requêtes. Cloudflare propose une
   liaison de limitation de débit dans Workers, présente dans le schéma de
   configuration de cette version de wrangler.
3. **Le préfixe `design/` n'a aucune règle de cycle de vie**, dit comme un choix
   dans `worker/index.ts` : seule la boutique sait quelle création est encore due
   contre une commande. Le balayage existe et rien ne l'appelle, ce que la séance
   12 a déjà écrit (`docs/seance-12-a-reprendre.md` §3.2). La conservation est la
   question 33.
4. **PHP 8.1.34 en production, en fin de vie.** Point de sécurité autant que de
   performance.
5. **`wp-content/plugins/teeshoop-core/README.md` est servi publiquement**
   (séance 12 §4.2) : `php-guard` ne balaie pas le `.md`.

---

## 5. Ce qui n'a pas été examiné, et il faut le savoir

- **Les dépendances.** Aucun audit de la chaîne d'approvisionnement n'a été fait
  dans cette passe.
- **WordPress et WooCommerce eux-mêmes**, et l'extension Stripe : le code de
  quelqu'un d'autre, non relu ici.
- **L'hébergement.** Les droits de fichiers, la configuration PHP et la
  séparation des comptes sur o2switch n'ont pas été audités.
- **Le personnel.** Un mot de passe d'administration WordPress faible bat tout ce
  qui précède, et rien ici ne le mesure.
