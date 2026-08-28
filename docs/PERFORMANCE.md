# Performance : ce qui a été mesuré, et sur quel instrument

> Séance 13, 27 août 2026. Tout chiffre ici a été produit en faisant tourner la
> chose réelle. Ce qui n'a pas été mesuré le dit.

---

## 1. L'instrument, avant les chiffres

Deux instruments, et il ne faut jamais comparer un chiffre de l'un à un chiffre
de l'autre.

**Le navigateur.** `npm run bench:cwv` (`scripts/cwv-bench.mjs`) : Chromium,
375 x 812 px, densité 3, tactile, agent mobile ; réseau bridé à 1,6 Mbit/s
descendant, 750 kbit/s montant, 150 ms de latence ; processeur au quart de sa
vitesse ; cache navigateur **froid** à chaque chargement ; médiane de cinq
chargements. C'est le profil « slow 4G » de Lighthouse, celui d'un acheteur
dans un train, pas celui d'un acheteur sur le quai.

**Le serveur.** `curl` en boucle contre le miroir, plus un profileur de requête
posé dans le conteneur (jamais dans le dépôt) qui compte les requêtes SQL et
mesure les phases de WordPress.

**Le miroir n'est pas la production.** Il tourne en docker sur un poste de
développement qui fait autre chose en même temps : les TTFB varient d'un facteur
deux d'une série à l'autre. **Les comptes de requêtes SQL, eux, sont
déterministes**, et c'est pour cela qu'ils sont cités en premier partout ici.

Et la production ne fait pas encore tourner ce code : `www.teeshoop.com` sert
toujours la boutique Woodmart, WordPress 7.1, avec Elementor, Fancy Product
Designer et LiteSpeed Cache. Le déploiement est la séance 14.

---

## 2. La mesure de départ, avant toute correction

`docs/perf/cwv-avant.json`, 27/08/2026.

| Page | TTFB | FCP | LCP | CLS | TBT | Poids |
|---|---:|---:|---:|---:|---:|---:|
| Accueil | 1 061 ms | 1 936 ms | 1 936 ms | 0,000 | 26 ms | 213 ko |
| Catégorie (139 réf.) | **14 045 ms** | 15 744 ms | **15 896 ms** | 0,000 | 129 ms | 659 ko |
| Catégorie, deux facettes | **13 492 ms** | 14 054 ms | **14 376 ms** | 0,000 | 351 ms | 327 ko |
| Fiche produit | 3 373 ms | 4 088 ms | 4 280 ms | 0,000 | 73 ms | 581 ko |
| Fiche produit + studio | 445 ms | 1 068 ms | 1 068 ms | 0,000 | 740 ms | 247 ko |
| Panier, une ligne | 1 067 ms | 1 856 ms | 4 468 ms | 0,045 | 1 265 ms | 1,65 Mo |
| Commander, une ligne | 1 820 ms | 2 884 ms | **6 900 ms** | 0,045 | **2 378 ms** | 1,65 Mo |

Le budget du projet est LCP sous 2,5 s. Trois pages sont dessus, une d'un facteur
six.

---

## 3. La page catégorie : quatorze secondes, et pourquoi

Le profil de requête met **12,2 s des 13,8 s dans la boucle produits** et 1,7 s
seulement dans MySQL. Ce n'était donc pas un problème de requêtes : c'était
vingt-quatre fiches à environ une demi-seconde chacune, en PHP.

`content-product.php` de WooCommerce ouvre sur `wc_product_class()`, qui demande
à `wc_get_product_class()` si le produit est en promotion
(`wc-template-functions.php:714`). Un produit **variable** répond à cette
question en lisant le prix de chacune de ses déclinaisons, et lire un prix veut
dire construire la déclinaison. La référence mesurée, B&C #E150 /women, en a
**159** et met **807 ms**.

WooCommerce a un cache pour exactement cela, et **il ne peut pas se déclencher
ici** : `class-wc-product-variable-data-store-cpt.php:529` n'écrit son transient
que si `validate_prices_data()` l'accepte, et cette fonction se termine
(ligne 1106) par « si le prix est vide, on veut reconstruire ». Or aucun prix de
vente n'est écrit sur le catalogue importé : c'est la question 42
(`H-Q42-MARGE-TEXTILE-NU`) et elle n'a pas de réponse. Mesuré : 807 ms à froid,
777 ms à chaud, transient jamais écrit, à chaque requête, pour toujours.

**La correction** (`wp-plugins/teeshoop-core/includes/Listing.php` et
`includes/listing/variable-product.php`) ne calcule rien : elle saute une
arithmétique qui ne peut pas changer une réponse. Le détail est dans l'en-tête du
fichier et dans le message du commit.

| | avant | après |
|---|---:|---:|
| TTFB de la catégorie | 14,0 s | **1,0 s** |
| requêtes SQL de la page | 315 | 130 |
| mémoire de pointe | 80 Mo | 18 Mo |
| `is_on_sale()` sur la référence à 159 déclinaisons | 963 ms | **10 ms** |
| TTFB de la fiche produit | 3,4 s | 0,7 s |

`tests/integration-listing.php` tient les deux classes côte à côte contre un
vrai WooCommerce et vérifie qu'elles répondent la même chose, pour une référence
sans prix et pour une référence avec.

---

## 4. Le cache objet : Redis

o2switch fait tourner Redis 8 et memcached sur le compte, relancés par le cron du
compte, socket à `~/.cpanel/redis/redis.sock`, et `php -m` y liste `redis`,
`memcached` et `igbinary`. Il manquait `wp-content/object-cache.php`.

**Ce qui a été installé** : le drop-in `redis-cache` (Till Krüss, v2.8.0), pas un
cache écrit à la main. Un `WP_Object_Cache` maison est deux cents lignes dont un
bug dans la gestion des groupes montre à un client le panier d'un autre ; ce
n'est pas un endroit où gagner deux cents lignes. Le cache de page reste celui de
LiteSpeed, au serveur : chaque outil fait une chose.

**Le miroir a été mis au niveau de la production pour que ce soit vérifiable** :
`wp-local/Dockerfile` ajoute `redis` et `igbinary` à l'image WordPress officielle,
qui n'en a aucun, et `docker-compose.yml` ajoute un service Redis. Sans cela le
drop-in aurait été écrit, déployé, et jamais exercé avant qu'un client le
rencontre.

Mesuré sur le miroir, à chaud, le compte de requêtes étant déterministe :

| Page | requêtes SQL avant | après | temps SQL avant | après |
|---|---:|---:|---:|---:|
| Accueil | 69 | **10** | 97,8 ms | 15,9 ms |
| Catégorie | 130 | **19** | 288,2 ms | ~100 ms |
| Fiche produit | 99 | **14** | 131,4 ms | ~32 ms |

Et la table des options :

| | avant | après |
|---|---:|---:|
| lignes dans `wp_options` | 6 081 | **383** |
| dont transients | 5 698 | **0** |
| options autoloadées | 319 lignes, 63,3 ko | inchangé |

Les 5 698 transients étaient lus et écrits en base à chaque requête. Ils sont
maintenant dans Redis. Les 63,3 ko autoloadés sont sains et ne demandent rien.

**Le préfixe de clés n'est pas de la décoration.** o2switch donne un Redis au
**compte**, pas au site. Deux WordPress sur un même compte sans préfixe partagent
un espace de clés, et le `alloptions` du second écrase celui du premier : deux
boutiques qui répondent avec les réglages l'une de l'autre. `verify:cache` vérifie
qu'un préfixe est défini.

---

## 5. Ce qu'un cache ne doit jamais faire, et comment on le sait

`npm run verify:cache` (`scripts/cache-verify.mjs`).

**Partie A, le cache objet, sur le miroir.** Deux navigateurs séparés ajoutent
chacun un produit différent, un troisième n'ajoute rien, et l'oracle est
**l'API Store** (`/wp-json/wc/store/v1/cart`) et non le HTML de `/panier/` :
cette page est le panier en blocs, ses lignes sont peintes par JavaScript, et la
première version de ce contrôle a signalé une ligne manquante qui n'était pas
encore affichée. Huit vérifications, dont celle qui dit que les deux paniers ont
réellement reçu quelque chose : deux paniers vides sont parfaitement isolés l'un
de l'autre et ne prouvent rien.

`--self-test` donne aux deux visiteurs **un seul pot de cookies**, c'est-à-dire la
forme exacte de la panne que ce contrôle existe pour attraper, et n'accepte de
sortir en 0 que si les assertions virent au rouge. Vérifié : trois assertions
rouges, les deux articles dans un panier de quatre pièces.

**Partie B, le cache de page.** La politique est écrite dans le script, une
entrée par URL avec sa raison, plutôt que dans l'écran de réglages d'une
extension où personne ne peut la relire ni la comparer. Quatre pages ne doivent
jamais être mises en cache entières : `/panier/`, `/commander/`, `/mon-compte/`
et la route de devis `POST /wp-json/teeshoop/v1/quote`.

**Elle n'a pas été éprouvée.** Le miroir est sous Apache, la production sous
LiteSpeed ; sans `--host`, le script dit qu'il n'a pas examiné le cache de page
au lieu de faire semblant. Il faut le relancer avec `--host=` contre un hôte
o2switch, et cela demande que notre code y soit, ce qui est la séance 14.

---

## 6. Ce qui n'est pas corrigé, et ce que cela coûte

**PHP 8.1.34 en production, en fin de vie.** `selectorctl` propose 8.1 à 8.5 sur
le compte. La montée est un point de sécurité autant que de performance et se
répète d'abord sur la préproduction. Le miroir tourne sur 8.3 et
`npm run test:php` sur ce que le poste a (8.5), donc **l'extension n'est
exercée sur 8.1 nulle part**, ce que l'en-tête de `docker-compose.yml` dit déjà.

**Le panier et le paiement pèsent 1,38 Mo de JavaScript** et bloquent le fil
principal 2 378 ms au moment de payer. C'est le panier en blocs de WooCommerce.
La séance 12 a construit sur ce panier en blocs délibérément ; alléger cela
demande de décider si l'on garde les blocs, ce qui n'est pas une décision de
performance.

**Le studio dans l'iframe n'est pas mesuré comme un tout.** L'iframe porte
`loading="lazy"` et se trouve sous la ligne de flottaison à 375 px, donc la
mesure de la fiche produit ci-dessus **ne contient pas le studio**. Voir la
section 7.

---

## 7. La mesure d'arrivée

Même instrument, même profil, `docs/perf/cwv-apres.json`, 28/08/2026.

| Page | LCP avant | LCP après | écart |
|---|---:|---:|---:|
| Accueil | 1 936 ms | 744 ms | -62 % |
| **Catégorie** | **15 896 ms** | **1 620 ms** | **-90 %** |
| Catégorie, deux facettes | 14 376 ms | 1 212 ms | -92 % |
| Fiche produit | 4 280 ms | 1 036 ms | -76 % |
| Fiche produit + studio | 1 068 ms | 932 ms | -13 % |
| Panier | 4 468 ms | 3 308 ms | -26 % |
| Commander | 6 900 ms | 3 720 ms | -46 % |

Le budget est LCP sous 2,5 s. **Six pages sur huit y sont**, contre cinq sur
sept au départ dont aucune des trois lourdes. Le panier et la page de paiement
n'y sont pas et la raison est au point 6 : 1,38 Mo de JavaScript de blocs
WooCommerce, que rien dans cette séance ne pouvait retirer sans décider de ne
plus utiliser le panier en blocs.

Le TBT tombe partout : 2 378 ms à 992 ms sur la page de paiement, 1 265 ms à
896 ms sur le panier, 129 ms à 23 ms sur la catégorie. Le CLS n'a pas bougé
(0,000 partout sauf 0,045 sur les deux pages de panier, sous le seuil de 0,1).

---

## 8. Le studio dans l'iframe, et ce que la mesure a démenti

La séance partait de l'idée que l'iframe portant `loading="lazy"` et se trouvant
sous la ligne de flottaison, une fiche produit ne payait pas le studio tant que
l'acheteur ne descendait pas. **C'est faux, et c'est la mesure qui le dit.**

Le compte des octets a été refait au niveau du navigateur et non à partir du
`resource timing` du document parent, pour une raison simple : un document ne
voit pas ce qu'une iframe d'une autre origine télécharge, ce sont deux
documents. La mesure de départ disait 247 ko et 25 requêtes ; c'était le parent
seul.

| | parent seul | tout compris |
|---|---:|---:|
| requêtes | 25 | **45** |
| poids | 247 ko | **653 ko** |
| dont l'iframe | 0 | **405 ko** |

Et les deux lectures, celle où l'on ne descend pas et celle où l'on descend
jusqu'au studio, donnent **le même chiffre**. Le cadre se charge avec la page :
à 375 px de large, avec une hauteur de `min(85dvh, 900px)`, il est assez près de
la fenêtre pour que le seuil de chargement paresseux de Chrome ne le diffère
pas. `loading="lazy"` est donc écrit et sans effet ici.

Le studio lui-même, mesuré dans son propre document : **FCP 448 ms, LCP 680 ms,
TBT 296 ms, 21 requêtes.** Le découpage de la séance R0 tient : les 1,1 Mo de
three.js ne sont pas dans ce chiffre, ils arrivent quand la vue 3D s'ouvre.

**Ce que cela veut dire.** Une fiche produit qui porte le studio coûte 653 ko au
lieu de 247, sur une connexion mobile bridée, à un acheteur qui n'a peut-être pas
demandé le personnalisateur. Ce n'est pas une régression, c'est un chiffre que
personne n'avait. Trois suites possibles, et aucune n'est une décision de
performance seule :

1. Ne rendre l'iframe qu'après un geste (le bouton « Personnaliser » existe déjà,
   `ProductPage::studio_requested`), donc ne pas la mettre dans le HTML du tout
   tant que `?personnaliser=1` n'est pas là. Sur le catalogue réel c'est déjà le
   cas ; c'est la fiche de démonstration qui porte le raccourci dans sa
   description.
2. Garder l'iframe et forcer le report avec un `IntersectionObserver`, ce qui
   marche là où `loading="lazy"` ne suffit pas.
3. Ne rien changer, et l'assumer : 405 ko pour un studio 3D est peu.

Le premier est probablement le bon et il ne coûte rien, mais il change ce qu'un
acheteur voit sur une fiche produit, ce qui est une décision d'interface.

