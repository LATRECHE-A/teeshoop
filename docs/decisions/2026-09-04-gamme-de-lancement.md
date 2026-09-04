# 4 septembre 2026 : ce que la boutique vend, et ce qu'elle se contente de montrer

Décisions prises seules, la nuit, personne n'étant joignable. Elles sont ici pour
qu'un désaccord porte sur la décision et pas sur une découverte.

Chaque chiffre de ce document a été produit en faisant tourner la chose réelle
contre le miroir docker. Ce qui n'a pas été mesuré le dit.

---

## 1. Le point de départ, mesuré

`teeshoop gamme etat` et `node scripts/launch-gate.mjs`, le 4 septembre au soir,
avant toute modification :

| | |
|---|---|
| produits publiés | 2 309 |
| produits **achetables** | **9** |
| dont montages de harnais | **8** |
| produits portant `_teeshoop_garment` | 10 |
| produits portant `_teeshoop_blank_ref` | **1** |
| refus du portail de mise en ligne | **23**, dont **6 « textile nu »** |

Les huit montages s'appellent « Probe fixture », « Probe fixture 2 », « Probe
fixture 3 », « Repro tee », « Tee de vérification », « Tee-shirt du harnais BAT »,
« T-shirt personnalisé (démonstration achat) » et « T-shirt personnalisable ». Le
neuvième, « T-shirt personnalisé, coton bio », est l'article de démonstration que
`teeshoop provisionner` créait lui-même.

Autrement dit : la seule chose qu'un client pouvait acheter sur cette boutique
était un harnais de test, et le portail de mise en ligne le disait déjà six fois.

---

## 2. Décision : deux produits, une référence

**Le catalogue se consulte, la gamme personnalisable s'achète.**

Les 2 300 références importées n'ont **aucun prix de vente**, et c'est une réponse
de l'associé, pas un oubli. Question 42, le 1er septembre 2026 : « Non applicable
au moteur e-commerce principal pour le lancement. Aucun taux général n'est
appliqué automatiquement à l'ensemble du catalogue pour une revente textile nue.
Aucune mise en vente massive de textile nu n'est nécessaire. »

Ce que le client achète est donc un **autre produit** : une offre de marquage,
simple, au tarif du studio, qui déclare sur quel textile nu elle est imprimée via
`_teeshoop_blank_ref`. C'est exactement ce que ce champ a été écrit pour porter,
et c'est ce que fait mistertee.

**Pourquoi pas un seul produit.** `WC_Product_Variable::is_purchasable()` exige un
prix sur les déclinaisons. En écrire un serait répondre à la question 42 à la
place de celui qui l'a tranchée. Et le prix d'une ligne personnalisée n'est de
toute façon pas un prix de déclinaison : il dépend de la quantité et de la
surface réellement imprimée, et c'est `Pricing::quote()` qui le calcule à l'ajout
au panier.

**Conséquence assumée** : deux fiches existent pour une même référence, l'une
consultable et l'autre achetable. `scripts/site-shots.mjs` capture les deux, parce
qu'elles ne rendent pas le même gabarit.

---

## 3. Décision : neuf références, deux familles, et ce qui reste dehors

`Gamme::RANGE`, dans `wp-plugins/teeshoop-core/includes/Gamme.php`. Quatre
critères mesurables et un jugement.

Mesurables : une photographie de face **et** une de dos, une fiche de mesures du
fabricant, du stock chez le fournisseur, et un nombre de coloris qui vaut la peine
d'être proposé. Le jugement : six marques différentes plutôt que six variantes
d'une seule, pour que la gamme couvre une fourchette de prix d'achat et pas un
point.

| Référence | Marque | Vêtement | Coloris proposés |
|---|---|---|---|
| 01542 | B&C #E150 | tee | 18 sur 18 |
| 01942 | B&C #E190 | tee | 18 sur 18 |
| 15001 | Fruit of the Loom Valueweight | tee | 17 sur 18 |
| 15009 | Gildan Softstyle | tee | 18 sur 18 |
| 18009 | Gildan Heavy Cotton | tee | 18 sur 18 |
| 00142 | B&C #inspire E150 | tee | 17 sur 18 |
| 27601 | Fruit of the Loom Classic Hooded | hoodie | 16 sur 18 |
| 23742 | B&C ID.333 Hoodie | hoodie | 16 sur 18 |
| 29009 | Gildan Heavy Blend Hooded | hoodie | 18 sur 18 |

### Ce qui n'y est pas, et pourquoi. Ce n'est pas un rétrécissement silencieux.

**Les polos (104 références), les chemises (100) et les 1 718 « autres textiles »
ne sont pas personnalisables.** Le champ `_teeshoop_garment` ne décide pas
seulement d'un prix : il décide de ce que l'éditeur **dessine**. Le studio ne
connaît que `tee` et `hoodie` (`src/garments/index.ts` déclare
`Record<'tee' | 'hoodie', GarmentArt>`). Un polo rangé sous `tee` montrerait au
client un col rond sur un vêtement qui a un col boutonné : c'est un visuel
fabriqué, pas une approximation, et `CLAUDE.md` l'interdit au même titre qu'un
prix inventé.

Le chemin qui les ouvrirait existe déjà à moitié : `CustomGarment` sait décorer
une **photographie** plutôt qu'un dessin, et la nuit 2 mesure désormais la zone
d'impression sur la photographie du fournisseur (voir le point 5). Ce qui manque
est la remise de ce vêtement photographique de la boutique vers le studio. C'est
le poste de travail que le brief de la nuit 2 annonce comme « plus gros que la
réécriture du personnalisateur », et il n'a pas été fait cette nuit.

**Les sweats à col rond ne sont pas dans la gamme non plus** (B&C ID.332 Crew,
Gildan Heavy Blend Crewneck, entre autres), pour la même raison exactement : le
dessin `hoodie` du studio a une capuche.

**Le Russell Athletic Authentic Hooded (26500) est exclu pour une raison de
prix.** Son textile nu coûte 23,78 à 28,13 EUR contre 14,55 pour le Fruit of the
Loom. Le tarif publié est un tarif par vêtement du studio, un seul pour tous les
sweats de la gamme : il doit tenir au-dessus du plancher pour le nu le **plus
cher** de sa famille, sinon la référence chère se vend à perte. Un tarif qui
couvre le Russell surfacture les trois autres de moitié.

---

## 4. Décision : les couleurs proposées sont les pastilles mesurées, pas les
dix-huit teintes du studio

`src/content/palettes.ts` porte dix-huit noms de teinture inventés pour une
démonstration. Ils décident de ce que l'éditeur **peint** et ne disent rien de ce
que l'atelier peut **acheter**.

`Gamme::palette()` dérive donc, par référence : chaque teinte du studio est
convertie en OKLab, classée par `Swatch::family()` (frontières refaites en séance
09 sur 300 noms étiquetés), et rapprochée du coloris **mesuré** le plus proche
parmi ceux que cette référence possède **dans la même famille**.

### Deux défauts trouvés à la mesure, et corrigés

**Un.** La porte par famille seule laisse passer des correspondances fausses.
Mesuré sur les neuf références : le « Rose » du studio (#F3A6C0) tombe sur
« Fuchsia » à 0,306 en OKLab ; sa « Menthe » (#BFE3D0) sur « Kelly Green » à
0,294. Les deux sont de la bonne famille et les deux mentent au client si c'est
le rond du studio qu'on lui montre.

**La correction n'est pas un plafond de distance.** Mesuré aussi : le « Noir » du
studio est #191C20 et le Black du fournisseur est à **0,225 de là, sur les neuf
références**. Un plafond à 0,12 (la tolérance `Colours::PHOTO_MAX` que la boutique
applique déjà entre une pastille et sa photo) refuserait le noir partout,
c'est-à-dire la couleur la plus vendue du métier. Le hex du studio est une teinte
de **rendu**, pas une revendication colorimétrique : un plafond colorimétrique
contre lui est le mauvais instrument.

**La correction est de changer ce qu'on montre.** Le nuancier traverse maintenant
la passerelle avec le **nom du fabricant** et la **pastille mesurée**
(`Product::META_BLANK_PALETTE`, `TEESHOOP_BRIDGE.colours`), et l'éditeur peint et
étiquette avec ça. Le client lit « Fuchsia » sous un rond fuchsia. C'est la
vérité, et elle ne coûte pas une couleur.

**Deux.** Sans règle supplémentaire, deux teintes du studio réclamaient la même
pastille : « Vert forêt » et « Vert gazon » tombaient toutes les deux sur
« Bottle Green » du B&C ID.333, « Sable » et « Marron » toutes les deux sur
« Mastic ». Deux choix distincts à l'écran, un seul vêtement à l'arrivée. La
règle : une pastille fournisseur ne sert qu'une fois, la plus proche la garde,
l'autre n'est pas proposée. C'est ce qui fait passer le B&C ID.333 de 18 à 16
coloris, et ces 16 sont vrais.

---

## 5. Décision : les montages sortent de la vente, ils ne sont pas supprimés

Cinq des neuf sont créés par leur propre harnais (`tests/e2e-support.php`,
`tests/bat-support.php`, `tests/demo-achat.php`, `tests/invoice-probe.php`). Les
supprimer casserait la prochaine exécution sans rien apprendre à personne.

Ils perdent leur **prix**, donc `WC_Product::is_purchasable()` répond non, donc
ils disparaissent du portail de mise en ligne et d'une boutique en ligne. Pas
« masqués du catalogue » : une adresse devinable est une capacité (`CLAUDE.md`
section 4), et un produit masqué mais achetable reste achetable par quiconque
tient l'URL.

`teeshoop provisionner` ne crée plus d'article de démonstration : il applique la
gamme, ou il dit qu'il n'y a rien à vendre tant que le catalogue n'est pas
importé. Un état vide lisible vaut mieux qu'une fiction avec un prix.

---

## 6. Le résultat, mesuré

| | avant | après |
|---|---|---|
| produits achetables | 9 | **9** |
| dont montages de harnais | 8 | **0** |
| dont offres réelles avec référence fournisseur | 0 | **9** |
| refus « textile nu » du portail | **6** | **0** |
| refus du portail, tous motifs | 23 | **17** |

Les 17 qui restent sont le registre (13 hypothèses bloquantes non confirmées), le
régime de TVA, la médiation et les CGV. Aucun n'est de notre ressort : ils sont
listés dans `ACCES-REQUIS.md` et dans `QUESTIONS-ASSOCIE.md` avec leur
propriétaire.
