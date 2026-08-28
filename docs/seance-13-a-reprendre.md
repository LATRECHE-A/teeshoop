# Séance 13, ce qui reste à reprendre

> Écrit à la fermeture de la séance 13 (performance et sécurité), le 28 août
> 2026. Tout chiffre ici a été produit en faisant tourner la chose réelle. Ce qui
> n'a pas été mesuré le dit.

---

## 1. Le fait qui change la lecture de tout le reste

**La production ne fait pas tourner ce code.** `www.teeshoop.com` sert toujours
la boutique d'origine : WordPress 7.1, thème Woodmart, Elementor, Fancy Product
Designer, LiteSpeed Cache, Wordfence. Notre extension et notre thème n'y sont
pas. Le déploiement est la séance 14.

Trois conséquences pour lire cette séance :

1. **Les mesures de performance sont prises sur le miroir**, qui fait tourner
   notre code, et pas sur la production, qui fait tourner autre chose. C'est le
   bon choix : on optimise ce qu'on va déployer. Mais le miroir est un poste de
   développement en docker et ses TTFB varient d'un facteur deux. Les **comptes
   de requêtes SQL** sont déterministes et c'est pour cela qu'ils sont cités en
   premier partout.
2. **Le cache de page n'a pas pu être éprouvé.** Le miroir est sous Apache,
   o2switch sous LiteSpeed. La politique est écrite et versionnée dans
   `scripts/cache-verify.mjs` ; elle attend un hôte LiteSpeed qui fasse tourner
   notre code, c'est-à-dire la séance 14.
3. **Le miroir est resté sur WordPress 7.0.4 alors que la production est passée
   à 7.1.** L'en-tête de `wp-local/docker-compose.yml` dit que le miroir suit la
   production ; il ne la suit plus. À reprendre au déploiement, quand on saura
   quelle version la boutique portera réellement.

---

## 2. Ce que la séance a mesuré, corrigé, et re-mesuré

Le détail est dans `docs/PERFORMANCE.md`. Le résumé :

| Page | LCP avant | LCP après | |
|---|---:|---:|---|
| Catégorie (139 réf.) | 15 896 ms | **1 620 ms** | -90 % |
| Catégorie, deux facettes | 14 376 ms | 1 212 ms | -92 % |
| Fiche produit | 4 280 ms | 1 036 ms | -76 % |
| Accueil | 1 936 ms | 744 ms | -62 % |
| Panier | 4 468 ms | 3 308 ms | -26 % |
| Commander | 6 900 ms | 3 720 ms | -46 % |

Deux corrections portent l'essentiel :

- **La boucle produits** demandait à chaque référence variable si elle était en
  promotion, ce à quoi WooCommerce répond en construisant ses 159 déclinaisons,
  et son propre cache **ne peut structurellement pas** se déclencher sur un
  catalogue sans prix de vente. 807 ms par fiche, à chaque requête, pour
  toujours.
- **Le cache objet Redis** : 69 requêtes SQL à 10 sur l'accueil, 130 à 19 sur la
  catégorie, et `wp_options` de 6 081 lignes à 383.

---

## 3. Ce qui bloque, et qui seul peut le débloquer

1. **Stripe (question 15).** Sans compte ni clés de test, le parcours de paiement
   n'a pas pu être exercé sous la politique de sécurité du contenu. C'est
   pourquoi elle est envoyée en **Report-Only** côté boutique et non appliquée.
   Trois des quatre hôtes Stripe qu'elle autorise ne sont pas prouvés depuis le
   dépôt. `H-Q15-STRIPE` le porte dans son champ `derives`.
2. **La marge textile (question 42).** Le catalogue ne porte aucun prix de vente,
   ce qui est la cause de la lenteur corrigée ici. `H-Q42-MARGE-TEXTILE-NU` porte
   maintenant ce que les deux chiffres de performance doivent à cette absence :
   le jour où un taux est posé, la mesure « avant » ne se reproduit plus.
3. **L'identité légale du vendeur (question 17)**, toujours. Elle empêche encore
   d'émettre une facture en production, et la veille alerte dessus sans pouvoir
   la résoudre.

---

## 4. Ce que la séance n'a délibérément pas construit

### 4.1 Le rapprochement de la surface d'encre facturée

Un acheteur peut envoyer un document de création cohérent avec lui-même mais
rétréci : les rectangles ET la surface réduits ensemble. L'atelier remesure la
vraie création quand il monte une planche, donc la vraie impression est pressée,
mais rien ne compare cette remesure à ce qui a été facturé.

**Fermeture** : que le constructeur de planches renvoie la surface remesurée avec
le découpage de tarification (et non celui que l'opérateur a pu forcer), et que
`Production.php` la compare dans les DEUX sens. Le contrôle existant à
`Production.php` ne regarde qu'un sens, et son commentaire dit pourquoi : plus de
film est la direction sûre. Elle l'est pour le film, pas pour le prix.

C'est une détection après paiement, pas une prévention, et c'est le seul chemin
possible : le serveur ne peut pas mesurer de l'encre.

### 4.2 Aucune limitation de débit éprouvée

Elle est déclarée (`ratelimits` dans `wrangler.jsonc`, vingt par minute et par
adresse sur les deux routes ouvertes) et **la liaison n'existe pas sous
`wrangler dev`**. Les sept assertions de `worker/ratelimit.test.ts` couvrent le
comportement quand elle manque ; ce qu'elles ne peuvent pas couvrir, c'est
qu'elle refuse réellement au vingt-et-unième appel. À vérifier au premier
déploiement.

### 4.3 Rien pour R2

Les créations des clients vivent chez Cloudflare et R2 n'a pas d'instantané. La
sauvegarde nocturne ne les couvre pas, et une commande dont l'artwork a disparu
est une commande que l'atelier ne peut pas imprimer. **C'est le trou le plus
sérieux qui reste après cette séance.** Il demande une décision : un second seau
répliqué, ou une copie périodique vers le disque o2switch.

### 4.4 Un prix en dollars, calculé par le studio, montré à un client français

**Trouvé pendant la relecture éditoriale, pas cherché, et il vaut mieux que la
ponctuation qui l'a fait apparaître.**

`src/app/panels/ProductPanel.tsx:127` affiche `product.from_price` avec
`PRICING[id].baseUsd.toFixed(2)`, et la chaîne française est `'dès {price} $'`.
Un acheteur français voit donc « dès 24.00 $ », un prix **en dollars**, **calculé
dans le navigateur**, avec un point décimal.

Cela contredit trois règles à la fois :

- section 2 de CLAUDE.md : « le studio affiche ce qu'on lui dit et ne calcule
  jamais un prix qu'un client peut payer ». `Pricing.php` est l'autorité.
- section 7 : « cm est l'unité côté client », et la monnaie du site est l'euro.
- section 6 : les nombres en prose française prennent la virgule.

`order.summary_estimated` a le même problème (`'Estimé : ${unit}/pièce'`).

**Non corrigé ici, délibérément.** Changer un symbole monétaire dans une
ponctuation serait exactement le genre de modification qui passe inaperçue dans
un gros diff, et la vraie correction n'est pas un symbole : c'est de décider ce
que ce panneau affiche tant que le serveur n'a pas donné de devis. La table
`PRICING` est un reste d'avant l'intégration WordPress.

Au passage et de la même famille : `shortcuts.nudge` annonce « Décaler de 0.05″ »
dans les deux langues. Des pouces, et un point décimal. Le studio travaille en
pouces en interne, donc changer l'affichage sans changer le pas serait mentir
d'une autre façon ; c'est une correction à faire avec la géométrie sous les yeux.

### 4.5 Les dix indicateurs du chapitre 1

Toujours pas calculés, et pour la raison écrite en séance 05 : neuf des dix sont
des ratios sur une population de commandes qui n'existe pas encore. Rien dans
cette séance n'a changé cela.

---

## 5. Ce qu'il faut savoir avant de toucher à ce que la séance a construit

1. **`run_worker_first` est maintenant `/*` moins quatre répertoires.** Ce n'est
   pas une simplification : c'est ce qui permet à la politique de sécurité
   d'atteindre le document du studio, qui est une ressource statique et que le
   Worker ne voyait donc jamais. Wrangler REFUSE de lister les anciennes routes à
   côté de `/*` comme redondantes, et ce à quoi chacune servait est écrit dans le
   commentaire plutôt que perdu avec la liste.

2. **La politique du studio porte un nonce et non une empreinte.** Une empreinte
   calculée au build est un piège : `dist/` n'est pas versionné, Vite recopie le
   bloc à l'octet près, et la prochaine retouche d'espacement livrerait une
   politique dont l'empreinte ne correspond plus, sans qu'aucun test ne rougisse
   et avec un studio blanc pour seul symptôme.

3. **La veille n'alerte que sur un changement d'état**, et le retour à la normale
   envoie un message aussi. Ne pas la « améliorer » en la faisant répéter : c'est
   exactement la modification qui la rend inutile.

4. **La suite d'intégration nettoie derrière elle depuis cette séance**, par une
   marque haute prise avant le premier test. Si une sous-suite se met à créer des
   objets avec des identifiants plus bas (ce qui ne peut pas arriver avec des
   auto-incréments), le balayage les manquerait, et l'assertion « laisse le
   miroir comme elle l'a trouvé » est ce qui le dirait.

5. **`scripts/style-guard.mjs` refuse aussi un fichier source qui n'est pas du
   texte.** Deux fichiers TypeScript versionnés portaient un caractère NUL brut
   dans une chaîne, à la place de la séquence d'échappement. Les deux
   produisaient la bonne chaîne à l'exécution et étaient BINAIRES pour tous les
   outils texte : `git diff` aurait affiché « Binary files differ », et
   l'inventaire des tirets cadratins les avait silencieusement exclus.

---

## 6. Ce que la séance 14 hérite directement

- **Éprouver le cache de page** sur un hôte LiteSpeed avec notre code :
  `npm run verify:cache --host=…`. Quatre pages ne doivent jamais être mises en
  cache entières.
- **Passer la politique de sécurité en application** une fois une carte payée de
  bout en bout, un défi 3-D Secure passé, et les rapports lus. Le drapeau est
  `TEESHOOP_CSP_ENFORCE`.
- **Vérifier que la limitation de débit refuse vraiment**, au premier
  déploiement.
- **Monter PHP de 8.1.34**, qui est en fin de vie, d'abord sur la préproduction.
  Point de sécurité autant que de performance.
- **Régler `SHOP_ORIGINS`** dans `wrangler.jsonc` : vide, le studio est servi sans
  directive `frame-ancestors`, et un avertissement le dit dans `wrangler tail`.
- **Décider pour R2** (point 4.3).
- **Le README de l'extension est servi publiquement** (`GET /wp-content/plugins/teeshoop-core/README.md`
  répond 200 avec 63 ko de documentation). Hérité de la séance 12 §4.2 et non
  corrigé ici : `php-guard` ne balaie pas le `.md`.
