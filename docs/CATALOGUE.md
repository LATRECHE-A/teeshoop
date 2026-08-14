# Le catalogue : d'où il vient, comment il se rafraîchit

État au 14 août 2026. Ce document dit **comment le catalogue arrive dans la boutique**,
**à quelle fréquence il doit être rafraîchi** et **ce qu'il coûte**. Les décisions de
modélisation sont argumentées dans l'en-tête de
`wp-plugins/teeshoop-core/includes/Catalogue.php` ; ici, c'est l'exploitation.

---

## Le chemin

```
fournisseur  ->  Worker Cloudflare  ->  WordPress
   XML/CSV        /api/fr/*            wp teeshoop catalogue importer
```

La boutique **ne parle jamais au fournisseur**. Elle appelle notre propre Worker, qui
détient les identifiants, lit le XML et le CSV du fournisseur et rend du JSON compact.
Ce n'est pas une préférence : l'analyseur du Worker encode une douzaine d'endroits où la
documentation du fournisseur et ses réponses réelles se contredisent, tous trouvés en
tapant sur le compte réel. Un second analyseur en PHP serait une seconde série de ces
décisions, et il divergerait.

Une référence = **un appel** : `GET /api/fr/catalogue/{style}` renvoie la fiche, nos
tarifs d'achat et le stock ensemble. Séparément, une passe complète ferait 1 389
aller-retours HTTPS depuis o2switch au lieu de 463.

### Ce qu'il faut pour que ça marche

| Élément | Où | Sans lui |
|---|---|---|
| `TEESHOOP_CATALOGUE_TOKEN` | `wp-config.php`, **jamais** en base | L'import refuse et le dit |
| Adresse du Worker | réglage `worker_url` de l'extension | L'import refuse et le dit |
| `ADMIN_TOKEN` | secret du Worker | Le Worker répond 401 à tout |

Le jeton est une **constante** et pas une option : les options partent dans toutes les
sauvegardes, dans toutes les migrations, et s'éditent depuis l'administration. Celui-ci
ouvre une route qui renvoie nos prix d'achat sur tout le catalogue.

---

## Les commandes

```bash
wp teeshoop catalogue importer                  # tout, jusqu'au bout
wp teeshoop catalogue importer --duree=1800     # 30 minutes puis on s'arrête proprement
wp teeshoop catalogue importer --max=5          # test de fumée
wp teeshoop catalogue importer --recommencer    # oublier la passe en cours et relister
wp teeshoop catalogue etat                      # où en est la passe
wp teeshoop catalogue purger                    # tout retirer (miroir local uniquement)
```

L'import est **idempotent** et **reprenable**. Relancé sans rien de changé en amont, il
n'écrit rien et l'annonce. Interrompu, il perd au plus la référence en cours : la passe
suivante repart au même index. C'est ce qui fait de `--duree` un créneau de cron utilisable
plutôt qu'un travail qu'il faut surveiller.

Idempotent **par comparaison, pas par empreinte** : chaque champ est relu et comparé avant
d'écrire. Une empreinte ne vaut que ce que vaut la liste des champs qu'on y a mis, et le
jour où quelqu'un ajoute un champ sans toucher à l'empreinte, l'import annonce « rien
changé » pour toujours pendant que la boutique dérive.

---

## La fréquence

| Passe | Rythme | Pourquoi |
|---|---|---|
| Catalogue complet | **une fois par nuit** | Le fournisseur réexporte tous les matins ; la fiche, les coloris et les tailles bougent rarement, le stock bouge tous les jours |
| Relance après échec | le créneau suivant | La passe reprend là où elle s'est arrêtée, il n'y a rien à faire à la main |

Ligne de crontab, sur o2switch (le cron serveur existe, vérifié le 14/08) :

```cron
17 3 * * *  cd ~/public_html && /usr/local/bin/wp teeshoop catalogue importer --duree=3600 --discret >> ~/logs/catalogue.log 2>&1
47 4 * * *  cd ~/public_html && /usr/local/bin/wp teeshoop catalogue importer --duree=1800 --discret >> ~/logs/catalogue.log 2>&1
```

Deux créneaux, pas un : le premier fait le gros, le second finit ce qui reste si la nuit a
été lente. Un créneau qui n'a rien à faire se termine en quelques secondes et écrit une
ligne.

**Ne pas utiliser WP-Cron.** Il ne se déclenche qu'à la visite d'une page, donc sur une
boutique calme il ne se déclenche pas, et il partage le temps d'exécution du visiteur.

---

## Ce que ça coûte

Mesuré le 14 août 2026 sur le catalogue réel.

| | |
|---|---|
| Références importables (t-shirts, polos, sweats) | **463** |
| Articles réellement vendus par le fournisseur | **26 399** |
| Combinaisons coloris × taille qui n'existent pas | **3 481** (13 %) |
| Articles par référence | médiane 36, p90 134, p99 292, maximum 366 |
| Références de plus de 30 articles | 256 |
| Photos de face et de dos copiées | 716, environ 45 Mo avant les vignettes |
| Photos par coloris **non** copiées | 4 241, soit 267 Mo, ~650 Mo et 34 000 fichiers après redimensionnement |

Les variations sont construites depuis **la liste d'articles du fournisseur**, jamais
depuis le produit cartésien coloris × taille. Le style 15009 affiche 49 coloris et
9 tailles mais ne vend que 334 articles : les 107 autres n'existent pas, et les publier
reviendrait à encaisser des commandes que personne ne peut honorer.

### Les images

Copiées dans WordPress : **la face et le dos**. Il faut de vraies pièces jointes parce que
la boutique, le panier, l'e-mail de commande et les données structurées adressent une image
par son identifiant.

Laissées sur le Worker : **les 4 241 photos par coloris**. Une à trois heures de
téléchargement sur un hébergement mutualisé pour changer une image quand un client choisit
une couleur, contre zéro octet et zéro seconde en les servant depuis le cache de
Cloudflare avec un en-tête immuable de trente jours. L'URL est posée sur la variation et
injectée dans le JSON des variations, donc la photo change quand même avec le coloris.

Ce qui ferait changer d'avis : un fournisseur qui recommence à photographier ses gammes
(une copie devient périmée sans que rien ne le dise, une image relayée non), ou le besoin
d'avoir ces photos dans Google Images, qui exige des pièces jointes.

---

## Le prix d'achat

Il est posé sur la variation, dans une meta privée, et il ne sort par aucune porte :
l'API REST authentifiée (produits **et** variations), l'API Store publique, l'export CSV
avec les meta personnalisées cochées, le JSON des variations envoyé au navigateur, et
l'affichage des meta de ligne de commande. Le préfixe souligné n'est pas la protection :
il masque la meta dans l'éditeur de produit et nulle part ailleurs.

`npm run verify:wp-catalogue` le vérifie en cherchant le nombre dans chacune de ces
sorties, **et** en prouvant d'abord que le nombre est bien en base, **et** en retirant le
verrou pour exiger que le même contrôle trouve la fuite. Un contrôle qui n'a jamais
déclenché n'est pas un contrôle.

Le numéro d'article du fournisseur est protégé de la même façon, pour une autre raison :
c'est une empreinte de qui nous fournit, et il suffit de le coller dans un moteur de
recherche.

---

## Le prix de vente

**Il n'y en a pas, tant que personne n'a fixé le taux de marge.**

`blank_margin_rate` vaut `null` dans la configuration de prix. Tant qu'il vaut `null`,
l'import n'écrit aucun prix : les produits sont consultables et non commandables. La Bible
donne la formule (prix conseillé = coût / (1 − taux de marge cible), chapitre 1) et laisse
explicitement le taux à décider. À 40 %, un t-shirt acheté 3,37 € se vend 5,62 € ; à 60 %,
8,43 €. Rien dans ce dépôt ne peut dire lequel est le bon, donc rien dans ce dépôt ne le
choisit. **Question 42** de `QUESTIONS-ASSOCIE.md`.

Le jour où le taux est réglé, la passe suivante valorise chaque variation depuis son propre
prix d'achat. Aucune reprise manuelle.

**À régler avant de le fixer**, et ce n'est pas un détail d'affichage : le prix produit est
HT, et la boutique est réglée pour afficher hors taxes (c'est le bon choix pour les
acheteurs professionnels auxquels s'adressent les fiches personnalisables). Une référence
importée n'a aucun gabarit Teeshoop autour d'elle : elle afficherait donc du HT brut, et un
particulier découvrirait 20 % de plus au paiement. En France, un prix affiché à un
consommateur doit être TTC. La question 41 passe donc avant la 42 : si ces textiles nus sont
vendus à des particuliers, le catalogue a besoin d'un affichage TTC avant que ce taux ne
soit posé.

Ce taux n'est **pas** le même nombre que `garments[*].base_ht`, qui est ce qu'un textile nu
apporte à une ligne **personnalisée**. Les deux cohabitent aujourd'hui et la séance 05
(moteur de coût) est l'endroit où l'un des deux doit gagner.

---

## Ce qui n'est délibérément pas fait

**Les références importées ne sont pas personnalisables.** Elles ne portent pas
`_teeshoop_garment`. `Pricing` valorise la personnalisation depuis un `base_ht` par
vêtement, et un produit qui aurait à la fois ce `base_ht` et son propre prix d'achat aurait
deux prix de textile nu susceptibles de diverger. Rattacher le catalogue au studio est le
travail de la séance 05, et il faudra que l'un des deux l'emporte.

**Rien n'est retiré de la boutique sur la foi d'une liste incomplète.** Si la passe de
listage s'arrête en chemin, l'import le dit et ne dépublie rien : une référence qu'on n'a
pas vue n'est pas une référence disparue.

**Les articles retirés du catalogue partent à la corbeille, pas à la poubelle.** Une
variation peut être sur une commande non expédiée.

---

## Questions ouvertes

| # | Question | Effet si la réponse change |
|---|---|---|
| 42 | Le taux de marge sur un textile nu revendu | Le catalogue devient commandable |
| 43 | Que valent les trois nombres de stock du fournisseur | Aujourd'hui seul le premier est traité comme du stock disponible ; le troisième vaut trente fois plus |
| 44 | Faut-il traduire les 442 noms de coloris | Aujourd'hui ce sont les noms du fabricant, en anglais pour la plupart |
