# 3 septembre 2026 : les rayons montrés, les vêtements montrables, et une file de 96 259 travaux morts

Quatre décisions prises seules cette nuit, sur des points où un désaccord est
raisonnable. Elles sont ici pour qu'on puisse en discuter sans avoir à les
redécouvrir.

---

## 1. La barre montre trois rayons et pas les onze de l'associé

**Sa demande.** Réponse 31 : conserver « le menu et l'organisation déjà définis ».
Son menu « Menu Principale teeshoop » compte onze catégories.

**Ce qui est mesuré.** Ses onze rayons ont un `count` de **0 produit chez lui**
aussi (seule « Tout » en porte 5). Chez nous, l'import fournisseur en remplit
trois : T-Shirts, Polos, Sweats, plus Chemises et Autres textiles que
`--famille=all` a ouverts. Les huit autres (Vestes, Débardeurs, Sport,
Casquettes, Bonnets, Tabliers, Sacs, Maison) sont vides des deux côtés, et
l'importateur ne va pas les chercher : `Catalogue::CATEGORIES` couvre cinq
familles parce que le studio imprime le haut du corps.

**Décision : ses noms, son ordre, et seulement ce qui est en stock.** Onze liens
dont huit mènent à « aucun produit » seraient la boutique annonçant huit fois par
page qu'elle est inachevée, sur chaque page. Le commentaire d'origine de
`top_categories()` disait déjà exactement cela et il avait raison.

**Ce qui a été repris de lui malgré tout :** ses noms exacts, casse comprise
(« T-shirts » est devenu « T-Shirts », slug intact pour ne casser aucune
adresse), son ordre alphabétique, et ses pages permanentes (Services, Suivi,
À propos) listées par slug, de sorte que le jour où l'une est créée le lien
apparaît sans toucher au code.

**Ce qu'il faudrait pour montrer les onze :** ouvrir les familles correspondantes
dans l'import, ce qui suppose que le classifieur du Worker sache les produire et
que Falk & Ross les référence. C'est un projet, pas un réglage.

## 2. Un vêtement qu'on ne peut pas regarder n'est pas une offre

Deux règles, du même principe, à deux endroits.

**Côté catalogue.** Une référence fournisseur sans photographie n'est pas
publiée. Mesuré : deux sur 574 (`SG Accessories TOWELS Tiber Bath Mat`,
`Babybugz Bandana Bib`), toutes deux dans « Autres textiles ». Le fournisseur ne
publie pas de photo pour elles ; ce n'est pas un téléchargement raté, `images()`
sait déjà distinguer les deux cas. Elles passent en brouillon marqué et
reviennent en ligne le jour où une photo arrive.

**Côté personnalisation.** `personalisable_products()` exige une photographie.
Cette liste dit « choisissez le vêtement que vous allez dessiner » : personne ne
choisit le support sur lequel il va poser le logo de son entreprise, en quantité,
à partir d'un nom.

**Ce que ces règles NE font pas :** elles ne suppriment pas la tuile « Sans
photo ». `placeholder_media()` reste juste pour un produit ajouté à la main, et
la fiche de démonstration `teeshoop-demo-tee` en affiche toujours deux, ce qui
est la preuve que la tuile fonctionne. Ce qui est refusé, c'est qu'elle
apparaisse sur une page de catalogue.

## 3. Le miroir montre une vraie référence comme vêtement personnalisable

La règle ci-dessus vidait la section « À personnaliser » du miroir, parce que les
neuf produits portant un modèle de studio y sont **tous des fixtures de harnais**
(« Probe fixture 3 », « Tee de vérification », « Repro tee »), aucun n'ayant de
photographie. Avec la section vide partaient aussi le prix affiché, le bouton
« Personnaliser » et le dessin de zone, qui se lisent tous sur le premier produit
personnalisable.

**Décision : rattacher le modèle `tee` du studio à une référence réelle du
catalogue** sur le miroir, `Russell Pure Organic Men's Pure Organic Tee`, 91
articles, photographiée par le fournisseur, coton bio comme la fixture qu'elle
remplace.

**C'est une donnée de miroir, pas une décision commerciale.** QUELLES références
sont ouvertes à la personnalisation en ligne appartient à l'associé. Rien n'a été
posé en préproduction ni en production. La question part avec les autres.

## 4. Action Scheduler : le réglage n'arrête pas ce qu'on croit

**Mesuré sur le miroir, le 3 septembre.**

| | avant | après |
|---|---|---|
| travaux en attente | 96 259 | 18 |
| dont ce seul crochet | 96 241 | 0 |
| journaux | 96 251 | 11 |
| tables Action Scheduler | 70,9 Mo | 0,3 Mo |
| base entière | 302,8 Mo | 232,2 Mo |

La purge a pris **4,3 secondes** et rendu **70,6 Mo**.

**Ce qu'ils faisaient.** Remplir `wp_wc_product_attributes_lookup`, qui contient
**0 ligne**, pour une fonctionnalité dont le réglage
`woocommerce_attribute_lookup_enabled` vaut **`no`**.

**Pourquoi le réglage ne les arrête pas, et c'est le point à retenir.** Ce
réglage gouverne si le FILTRAGE lit la table. La mise en file est dans
`LookupDataStore::on_product_changed()`, dont la seule garde est
`check_lookup_table_exists()`, et la table existe sur toute installation
WooCommerce parce que Woo la crée. Éteindre la fonctionnalité dans
l'administration laisse donc le travail se programmer pour toujours. Vérifié :
la file est repassée de 18 à 1 828 en vingt minutes d'import.

`on_product_changed` n'est appelé par aucun crochet (`WC_Product::save()`
l'appelle sur le conteneur directement), il n'y a donc rien à décrocher. Les
filtres `pre_as_enqueue_async_action` et `pre_as_schedule_single_action`
d'Action Scheduler sont la voie prévue, et `Compat::refuse_dead_lookup()` s'y
place.

**Mesure de l'effet**, sur 180 secondes d'import actif pendant lesquelles 12
produits ont été écrits : la file est passée de 1 359 à **1 359**. Avant le
garde-fou elle montait d'environ 75 par minute.

**Il échoue dans le sens qui garde la fonctionnalité vivante.** Dès que le
réglage repasse à `yes`, le filtre rend `null` et tout est reprogrammé : un cache
de performance jamais reconstruit serait une boutique lente que personne ne sait
expliquer, ce qui est pire que le défaut corrigé.
