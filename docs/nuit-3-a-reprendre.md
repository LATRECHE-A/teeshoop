# Nuit 3, ce qui reste à reprendre

> Écrite à la fermeture de la nuit du 5 septembre 2026. Tout chiffre ici a été
> produit en faisant tourner la chose réelle. Ce qui n'a pas été mesuré le dit.

---

## 1. L'état des lieux, avant et après

| | Avant | Après |
|---|---|---|
| Le personnalisateur ouvre sur le produit cliqué | **non** | **oui** |
| Origine du personnalisateur | `tshop.abdellah-latreche04.workers.dev` | la boutique |
| Charge immédiate, compressée | 246 473 o | **114 385 o** (46,4 %) |
| Ce qui reste derrière un clic | 0 (tout était eager ou dans le cadre) | 1 362 187 o |
| Stockage des fichiers du client | tiers, partitionné | même origine |
| Worker en panne : la fiche dit quelque chose | **non** | **oui** |
| Moteurs de prix atteignables par un client | **2** (dont un en dollars) | **1** |
| Question « combien, quelles tailles » posée | **deux fois** | **une fois** |
| `npm run verify:wp-e2e` | 109 (chemin encadré) | **109** (chemin natif) |
| `npm run test:wp` | 241 | **241** |
| Portes sur le paquet client | 2 | **3** (`verify:editeur`, 33 assertions) |

---

## 2. Ce qui n'est pas fini, nommément

### Trois postes de la vue avancée ne sont pas construits

Aucun n'est sur le chemin d'un achat. Un client qui n'ouvre jamais cette vue
achète exactement comme avant, et un qui l'ouvre y trouve les quatre autres
postes (dos et manches, plusieurs calques, texte et polices, alignement au
centimètre).

**Le détourage.** Mesuré en le construisant : `vite` copie 13 480 ko de
WebAssembly dans le répertoire du greffon, deux fois, parce qu'`onnxruntime-web`
référence son binaire par `new URL(…, import.meta.url)` et qu'aucune option ne
l'en empêche. Avec le modèle ONNX, 4 600 ko, cela fait 18 Mo qui partiraient en
rsync vers o2switch à chaque déploiement. Les servir depuis le Worker marche pour
le téléchargement (`connect-src` autorise déjà cette origine) et demande en plus
`'wasm-unsafe-eval'` dans le `script-src` de la boutique. C'est petit, c'est
faisable, et c'est une modification de la politique de sécurité de la boutique.
**Question Q67 posée à l'associé** : combien de ses clients envoient un visuel
avec un fond à retirer. Si c'est rare, la phrase que l'éditeur affiche suffit.

**La réalité augmentée.** `uploadArModel` poste sur `POST /api/ar`, qui n'expose
aucun en-tête CORS. Depuis la page de la boutique l'envoi partirait et la réponse
serait illisible. C'est une ligne dans `worker/index.ts`, du même genre que celle
écrite cette nuit pour `/api/design`, et le brief interdisait tout autre
changement Worker.

**L'aperçu 3D.** Monté par React dans le studio (`src/app/Scene3D.tsx`). Le
porter est un vrai poste : three.js, la scène, les textures, la caméra. À moitié,
ce serait une seconde implémentation du rendu du vêtement.

### La photographie et la zone : deux relevés que le brief supposait faux

Le brief de la nuit dit « sa zone d'impression mesurée par la nuit 2 » et « la
photographie du vêtement dans la couleur choisie ». Les deux décrivent des
données qui n'existent pas :

- **zéro `_teeshoop_zone_impression`** sur les 2 309 produits du miroir, et neuf
  `_teeshoop_zone_refus`. Le rapport de la nuit 2 le dit lui-même : la mesure a
  été construite, lancée sur les dix-huit photographies, et les a refusées une
  par une, parce que les vues de face du fournisseur sont des mannequins vivants ;
- **54 coloris, une photographie distincte** sur le Gildan Heavy Cotton. Le
  fournisseur n'a pas livré de vue par coloris, ou l'import ne l'a pas reprise.

Ce qui a été livré : la zone dérivée de `Garments::area_by_size()`, c'est-à-dire
la même source que `Design::unprintable_sizes` applique pour refuser une ligne,
dessinée sur le gabarit calibré du studio où sa position est connue ; la
photographie de la référence, une fois ; et la couleur, qui est vraie, parce que
la pastille est la mesure prise sur la puce du fabricant. Une légende dit lequel
est lequel. Détail et chemins de sortie dans
`docs/decisions/2026-09-05-la-zone-dessinee-et-la-photographie.md`, questions Q66
et Q67 dans `QUESTIONS-ASSOCIE.md`.

### Ce que le cadre achetait et qui est perdu

L'iframe isolait la création du client des autres scripts de la page. Ce n'est
plus le cas : le thème, une extension WooCommerce ou une balise de mesure sur une
fiche produit peuvent maintenant lire le document de création et le stockage de
même origine. Ces scripts partageaient déjà l'origine du nonce, donc cela
n'élargit pas la portée d'un attaquant ; cela élargit le rayon d'action d'une
extension compromise. C'est le prix du changement, il est écrit dans
`.claude/skills/security/SKILL.md` et dans `docs/SECURITE.md`, et il doit peser
dans toute décision d'ajouter une extension à une fiche produit.

### `verify:cors` ne tourne dans aucun travail de CI

Comme `verify:csp` et `verify:admin-gate`, il a besoin d'un `wrangler dev`
vivant, et le fichier `.github/workflows/ci.yml` n'en démarre pas. Les trois sont
dans le même cas et c'est la convention actuelle du dépôt, mais c'est exactement
la forme qui a déjà coûté une séance (« une porte qui n'est dans aucun travail »).
À reprendre ensemble, pas séparément.

---

## 3. Ce que la passe adversariale a trouvé, et qui est corrigé

Quatre lentilles en parallèle sur le diff. Elle a de nouveau battu les tests :
tout ce qui suit était vert, typé et livré.

| Trouvaille | Conséquence | Corrigé par |
|---|---|---|
| Les polices d'impression rendaient 404 : `vite` écrivait des URL racine-absolues et le greffon est servi sous `/wp-content/…`. `document.fonts.load()` se résout quand même, donc le texte était mesuré dans la police de repli | pièce facturée 20,6 x 2,7 cm, imprimée 14,7 x 3,7 cm | `base: './'` et une porte sur les octets livrés |
| L'achat lisait l'état vivant à quatre instants, avec trois allers-retours entre eux | jusqu'à 325,00 EUR d'écart entre le prix montré et le prix facturé | un instantané pris une fois |
| L'éditeur écrivait « TVA X % incluse » depuis le taux, sans regarder le régime | « TVA 0 % incluse » sous la franchise, où la loi impose une autre mention | il lit `Settings::price_bases()` |
| Un devis annulé pouvait ressusciter | un achat de 30 pièces refusé comme « sur devis » | l'abandon remonte au-dessus du retour anticipé |
| « Ajouté au panier. » survivait à toute modification | le client suit un lien vers un panier qui contient autre chose | la confirmation tombe dès que la création change |
| L'éditeur offrait des tailles que le panier refuse | refus après la mesure et le téléversement, avec une phrase qui donne la mauvaise raison | l'intersection charte de famille / fiche du fabricant |
| Un stockage plein rapporté comme un fichier illisible | le client refait ce qui vient de marcher, la vente est perdue | deux phrases, deux causes |
| « Rien n'a été facturé » affirmé sur l'ajout au panier | une ligne réelle peut exister, un second essai en crée une seconde | une phrase qui envoie vérifier |
| Les décalages de la vue avancée bornés à la zone entière | un calque hors zone disparaît du film ET du prix, en silence | bornés à la moitié |
| Les faces envoyées au panier prises du dépôt | le garde de divergence de `Cart::add` ne pouvait pas échouer | elles viennent du devis |
| `photoSure` acceptait `/\evil.tld/x.png` | une image d'une autre origine dans la page (pas atteignable aujourd'hui) | un caractère |
| `editeur-guard` ne lisait que le fichier d'entrée | `avancee.ts` et tout ce qu'il importe n'étaient dans aucun graphe gardé | les interdits sur le graphe qui suit les imports paresseux |
| Son détecteur de paquets lisait les commentaires | il rapportait « the same id, different pixels » comme une dépendance npm | les commentaires retirés d'abord |
| `SCAN_SKIP` de `hypotheses-guard` comparait un NOM de répertoire | tout futur `src/editeur/` cessait d'être contrôlé en silence | comparaison sur le chemin |
| `theme-fonts-check` filtrait ses feuilles par `existsSync` | `bridge.css` allait disparaître du contrôle sans un mot | une feuille listée et absente est une panne |
| Trois normalisations d'origine identiques à une liste blanche près | `connect-src` refuserait un dépôt qu'il croit autoriser | `Url::origin_of`, une seule |

Et `verify:vendable` a attrapé une chose que la passe n'avait pas vue : le thème
appelait encore `ProductPage::STUDIO_ARG` et **toute fiche produit rendait 500**.
C'est le travail pour lequel il a été écrit.

---

## 4. Les portes, et ce qu'on leur a fait dire

Chacune a été cassée une fois exprès, dans le transcript :

- `worker/cors.ts` : `===` remplacé par `startsWith`, 5 tests unitaires sur 21 et
  3 assertions sur 19 du harnais réel au rouge, puis remis ;
- `scripts/editeur-guard.mjs` : l'arête vers `@/scenes` rebranchée dans
  `src/native/editeur.ts`, la porte a nommé l'importateur, puis retirée ;
- `scripts/fiche-vendable.mjs` : les deux chemins d'achat cassés (paquet retiré,
  `studio_origin` vidé). Il a dit « vend » à tort, parce qu'il comptait l'ancre
  « Personnaliser » sans regarder derrière. Corrigé, il dit « NON, par rien ».

---

## 5. Ce qu'il faut fournir

Rien de nouveau côté accès : tout ce dont cette nuit avait besoin était déjà là
(docker, PHP, wrangler, playwright). `ACCES-REQUIS.md` n'a pas bougé.

Deux décisions attendent l'associé, elles sont dans `QUESTIONS-ASSOCIE.md` :

- **Q66** : le fournisseur a-t-il une photographie par coloris ;
- **Q67** : le détourage automatique doit-il revenir en ligne, sachant qu'il coûte
  une modification de la politique de sécurité de la boutique.

Et une décision revient au développeur : `'wasm-unsafe-eval'` dans le
`script-src` de la boutique, et le CORS de `POST /api/ar`. Les deux sont petits
et mesurables ; aucun ne se décide à la fin d'une nuit dont le brief dit que le
CORS des routes de création est le seul changement d'infrastructure autorisé.
