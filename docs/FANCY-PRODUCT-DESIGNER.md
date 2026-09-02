# Fancy Product Designer : ce que la base dit, et ce qu'on possède

> Écrit en séance 14, le 2 septembre 2026. Tout ce qui suit a été relevé sur la
> boutique de production en SSH. Rien n'est déduit d'une documentation.

Fancy Product Designer est l'extension de personnalisation de produit que le
studio Teeshoop remplace. La séance 14 devait répondre à deux questions avant
qu'on puisse envisager de la désactiver : **est-ce qu'une commande en dépend**,
et **qu'est-ce qu'on possède**.

---

## 1. Aucune commande ne porte de donnée FPD

C'était la condition posée par le brief : « confirmer en SSH qu'aucune commande
terminée ne porte `_fpd_data`. Si une seule le fait, ces commandes doivent rester
lisibles, donc les exporter d'abord. »

**Aucune ne le fait.** Vérifié de cinq façons indépendantes, parce qu'une seule
requête sur une seule table ne prouve rien sur une boutique où le stockage des
commandes a changé de forme :

| Où | Ce qui a été compté | Résultat |
|---|---|---|
| `wp68_wc_orders_meta` (HPOS, le stockage actuel) | clés contenant `fpd`, valeurs contenant `fancy_product` | **0** |
| `wp68_woocommerce_order_itemmeta` (la ligne de commande) | idem | **0** |
| `wp68_postmeta` des `shop_order` (l'ancien stockage, encore présent) | clés contenant `fpd` | **0** |
| `wp68_comments` (les notes de commande) | contenu citant `fpd` | **0** |
| Recensement complet des clés | 42 clés distinctes en HPOS, 22 sur les lignes | aucune n'est FPD |

Le recensement complet est le contrôle qui compte : il ne cherche pas `fpd`, il
liste **toutes** les clés existantes et on constate qu'aucune n'appartient à
l'extension. Une recherche par motif ne peut pas trouver une clé qui s'appellerait
autrement.

**Pourquoi c'est cohérent.** Les quinze commandes vont du 21 novembre 2024 au
18 avril 2025 et portent toutes des articles de revente : huile capillaire Dabur
Amla, tapis et coussins d'acupression, coussin lombaire. Aucun vêtement, aucune
personnalisation. FPD a été installé le **25 août 2025**, soit quatre mois après
la dernière commande. Il n'a jamais eu l'occasion de servir.

**Il n'y a donc rien à exporter avant de le retirer**, et c'est la seule raison
pour laquelle cette page peut conclure aussi simplement.

---

## 2. Ce qui dépend de FPD aujourd'hui : un produit, et rien d'autre

| Ce qu'on a cherché | Ce qu'on a trouvé |
|---|---|
| Produits configurés avec FPD | **1** : ID 3596, « T-shirt Impérial SOL'S », publié, créé le 25/08/2025 |
| Contenus portant un raccourci `fancy_product` | 4 lignes, qui sont **le produit 3596 et trois de ses propres révisions**. Donc une seule chose. |
| Table `wp68_fpd_products` | 1 ligne, « Men Standard », scène de 600 x 660 |
| Table `wp68_fpd_views` | 2 lignes (recto, verso) |
| Fichiers sous `wp-content/uploads` | 9, tous dans `fpd_imports/shirts_men_standard/` : le gabarit livré avec l'extension (deux SVG, trois PNG, un `product.json`, deux aperçus). **Aucune création de client.** |

Le « 4 » de la deuxième ligne est un piège qu'il faut noter : compté sans regarder
`post_type`, il donne l'impression que quatre pages seraient cassées par un
retrait. Trois sont des révisions WordPress du même produit.

---

## 3. Ce que ça coûte pendant qu'on ne s'en sert pas

FPD **charge ses feuilles de style sur les pages publiques où aucun produit
personnalisable n'existe**. Mesuré le 02/09/2026 en lisant le HTML réellement
servi :

| Page | Références à FPD dans le HTML |
|---|---|
| `https://www.teeshoop.com/` | 2 (`FancyProductDesigner-all.min.css`, `fancy-product.css?ver=6.4.8`) |
| `https://www.teeshoop.com/boutique/` | 2 |

L'extension occupe **41 Mo** sur le disque. Ce n'est pas un argument suffisant
pour la retirer, et c'est un argument à mettre dans la balance : elle est servie à
chaque visiteur pour un seul produit qui n'a jamais été vendu.

---

## 4. Ce qu'on possède

**Une licence CodeCanyon (Envato) pour l'article 7758048**, qui est Fancy Product
Designer. Le code d'achat est enregistré dans l'option
`envato_purchase_code_7758048` de la base. C'est la seule preuve d'achat que le
site contient, et elle suffit pour réinstaller ou rouvrir un ticket de support.

**La licence est en deux moitiés**, et le fichier
`Licensing/README_License.txt` de l'extension le dit lui-même :

> (1) the PHP code and integrated HTML are licensed under the General Public
> License (GPL). (2) All other parts, but not limited to the CSS code, images,
> and design are licensed according to the terms of your purchased license.

Autrement dit : le PHP est sous GPL et se garde, se modifie et se copie
librement ; les feuilles de style, les images et le dessin restent sous la licence
achetée sur ThemeForest/CodeCanyon.

**Ce que je ne peux PAS affirmer**, et il ne faut pas le deviner : le **type**
exact de licence Envato (Regular ou Extended) et sa date d'achat. Un code d'achat
ne dit ni l'un ni l'autre ; ils se lisent dans le compte Envato de qui l'a
achetée, sous « Downloads ». La distinction compte si Teeshoop revend un jour un
produit fini qui embarque l'extension, ce qui n'est pas le projet.

**Le module « Genius » n'est pas licencié.** L'option `fpd_genius_license_key`
n'existe pas dans la base, et le code de l'extension la lit pour décider d'activer
l'export avancé. Cette partie-là n'a jamais été payée ou jamais été posée.

**Une licence Envato ne se périme pas.** Ce qui se périme est le support et les
mises à jour, six ou douze mois après l'achat. Désactiver l'extension ne fait donc
rien perdre : elle se réactive plus tard avec le même code d'achat.

---

## 5. Ce que je recommande, et ce qui n'est pas à moi de décider

**Ce n'est pas à nous de la retirer de la boutique.** C'est un logiciel que
l'associé a payé, sur son site, et la séance 14 laisse la production tranquille.

Ce qui peut se faire sans lui demander quoi que ce soit, et qui est fait :
l'inventaire ci-dessus.

Ce qui se propose :

1. **Désactiver, pas supprimer.** Une désactivation laisse les tables, les
   fichiers et le code d'achat en place et se défait en un clic. Une suppression
   emporte `wp68_fpd_products`, `wp68_fpd_views` et 41 Mo de fichiers.
2. **En préproduction d'abord**, et vérifier ensuite que le produit 3596 s'affiche
   toujours (sans son personnalisateur) et que rien ne casse ailleurs.
3. **Sauvegarder les deux tables et le produit 3596 avant**, même si rien n'en
   dépend : `wp db export --tables=wp68_fpd_products,wp68_fpd_views` et
   `wp export --post__in=3596`. C'est trente secondes et ça rend la manoeuvre
   réversible sans restaurer toute la base.
4. **Ne rien faire en production tant que l'associé n'a pas répondu.** La question
   est la même que la question 20 sur les produits de démonstration : le défaut
   est « on peut », et un défaut n'est pas un feu vert.

---

## 6. Ce qui reste à demander

| Question | À qui | Pourquoi ça compte |
|---|---|---|
| Le type de licence Envato et sa date d'achat | l'associé, dans son compte Envato | Décide si le support est encore ouvert et si l'extension pourrait accompagner un produit revendu |
| Faut-il désactiver FPD sur la boutique | l'associé | Il l'a payée. Le studio la remplace, mais le calendrier est le sien |
| Le module Genius a-t-il été acheté | l'associé | La clé n'est pas dans la base ; soit il n'a pas été acheté, soit il n'a jamais été posé |
