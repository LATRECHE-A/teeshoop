# Nuit 3, ce qui reste à reprendre

> Écrite à la fermeture de la nuit du 5 septembre 2026. Tout chiffre ici a été
> produit en faisant tourner la chose réelle. Ce qui n'a pas été mesuré le dit.

---

## 1. L'état des lieux, avant et après

| | Avant | Après |
|---|---|---|
| Le personnalisateur ouvre sur le produit cliqué | **non** | **oui** |
| Origine du personnalisateur | `tshop.abdellah-latreche04.workers.dev` | la boutique |
| Charge immédiate, compressée | 246 473 o | **102 163 o** (41,4 %) |
| Ce qui reste derrière un clic | 0 (tout était eager ou dans le cadre) | 1 362 187 o |
| Stockage des fichiers du client | tiers, partitionné | même origine |
| Worker en panne : la fiche dit quelque chose | **non** | **oui** |
| Moteurs de prix atteignables par un client | **2** (dont un en dollars) | **1** |
| Question « combien, quelles tailles » posée | **deux fois** | **une fois** |
| `npm run verify:wp-e2e` | 109 (chemin encadré) | **109** (chemin natif) |
| `npm run test:wp` | 241 | **241** |
| Portes sur le paquet client | 2 | **3** (`verify:editeur`, 35 assertions) |

---

## 2. Ce qui n'est pas fini, nommément

### Les sept postes de la vue avancée sont construits (5 septembre, seconde passe)

Dos et manches, plusieurs calques, texte et polices, alignement au centimètre,
détourage, aperçu en volume, réalité augmentée. Les trois derniers ont été
ajoutés après coup, à la demande du développeur, et chacun a coûté une mesure.

**Le détourage** ne pouvait pas embarquer son runtime : 13 480 ko de
WebAssembly copiés deux fois dans le répertoire du greffon, et
`external` sur `.wasm` ne les attrape pas (ce n'est pas un import, c'est un
actif émis). Un greffon de vite les retire maintenant au moment du bundle, et
échoue bruyamment s'il n'en retire aucun. Le runtime est lu sur le Worker, qui
le sert déjà publiquement, et `u2netp.onnx` a déménagé de `/models/` vers
`/ort/` parce qu'un poids ONNX n'est pas un modèle 3D.

**La politique de sécurité de la boutique n'a PAS changé**, et c'est le
résultat de la mesure plutôt qu'un renoncement. `'wasm-unsafe-eval'` a été
ajouté, puis retiré : politique appliquée (pas Report-Only), un détourage réel
réussit en 4,3 s SANS le jeton, parce que la compilation a lieu dans un Web
Worker et qu'un worker dédié prend sa politique de ses propres en-têtes de
réponse, pas de ceux du document. Le jeton n'achèterait que le chemin de repli
sur le fil principal, qui ne sert que sur un navigateur incapable de démarrer un
Web Worker de module, et qui rencontre l'état vide prévu.

**L'aperçu en volume et la réalité augmentée sont le même objet**, et c'est ce
qui les a rendus faisables en une heure : `buildArModel` construit un vêtement
portant la création, le GLB qu'il rend EST l'aperçu, et c'est le même octet que
le téléphone reçoit. La scène three.js est celle de la page du code QR,
extraite dans `src/lib/glbStage.ts` plutôt que recopiée, avec un démontage que
l'original n'avait pas (contexte WebGL libéré, géométries et textures du GLTF
disposées, écouteurs retirés).

Ce que ça a coûté au Worker : `POST /api/ar` porte le CORS comme les routes de
création, et `/ort/*` et `/models/*` ont perdu leur négation dans
`run_worker_first` pour recevoir le même en-tête. Mesuré deux fois avant de
comprendre : sans en-tête sur `/ort/`, quatre `net::ERR_FAILED` et un détourage
qui échoue en 0,1 s ; sans en-tête sur `/models/`, deux 404 et un aperçu qui
affiche « le modèle n'a pas pu être construit ».

Ce que ça coûte à la première charge : **rien**. 100 808 octets compressés,
40,9 % du studio encadré, trois octets de plus qu'avant l'ajout des trois postes.
Les 2,2 Mo de three.js, d'exportateurs et de polices sont derrière deux clics, et
`scripts/editeur-guard.mjs` le mesure avec deux parcours du même graphe : les
interdits portent sur celui QUI SUIT les imports paresseux, le poids sur celui
qui ne les suit pas, et chaque poste lourd est asserté dans les deux sens
(absent avant le clic, PRÉSENT derrière, sinon « corriger » une violation en
supprimant la fonctionnalité passerait).

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
| Le paquet portait la table de traduction et ses DEUX langues, pour trois étiquettes de canevas | 9 664 octets compressés d'anglais chez chaque client d'une boutique française, sous un commentaire qui affirmait le contraire | `EditorEngine` DEMANDE ses étiquettes ; 12 218 octets de moins, et deux portes (graphe + chaîne « Print area ») |
| Le marcheur de graphe partagé lisait les commentaires | il voyait encore `@/i18n` dans un fichier qui ne l'importait plus, parce que le commentaire qui explique la suppression cite l'ancienne ligne | les commentaires retirés avant la recherche, dans `admin-boundary.mjs` |
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
