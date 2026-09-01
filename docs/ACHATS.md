# Commander les textiles au fournisseur

Décidé le 19 août 2026, séance 08. Ce document dit **ce que la boutique fait quand il
faut acheter des vêtements nus**, pourquoi, et ce qu'elle refuse de faire.

Il existe parce que la question 22 est bloquante et n'a pas de réponse : « Acceptez-vous
que le système passe automatiquement les commandes fournisseurs, ou voulez-vous valider
chaque commande à la main ? » Ce qui suit est l'hypothèse retenue, et elle est réversible
en changeant un écran.

---

## La décision

**La commande fournisseur est préparée automatiquement. Elle n'est transmise qu'après une
confirmation humaine, écran par écran, et derrière un mot de passe.**

C'est exactement l'hypothèse par défaut écrite dans la question 22. Elle n'a pas été
retenue par défaut : les trois options ont été comparées avant, et les deux autres ont un
mode de défaillance qui coûte plus cher.

### Les trois options, et ce que chacune casse

**Ne rien automatiser.** La boutique exporte un panier, l'associé le ressaisit sur le site
du fournisseur.

> Ce qui casse : la ressaisie. Retaper quarante lignes de référence, coloris, taille et
> quantité est précisément l'endroit où l'on se trompe de taille, et se tromper de taille
> est la faute la plus chère de tout le système : le film est déjà imprimé quand les
> cartons arrivent, la série entière est bonne à jeter. Il n'y a par ailleurs aucune trace
> à rapprocher de la facture, et personne ne peut dire si un envoi a déjà eu lieu.

**Préparer puis confirmer.** La boutique construit le panier depuis les commandes et leurs
grilles de tailles, l'affiche, et un humain nommé confirme avant transmission.

> Ce qui casse : le tampon automatique. Un opérateur qui voit le même écran tous les jours
> finit par cliquer sans lire. C'est atténué en faisant de la préparation et de l'envoi
> **deux actes sur deux écrans**, en mettant le total, le nombre de lignes et le mode du
> compte fournisseur au premier plan, et en demandant une confirmation **tapée** plutôt
> qu'un bouton de plus dans une rangée de boutons.

**Automatiser au-dessus d'un seuil de confiance.** La boutique envoie seule quand elle est
sûre.

> Ce qui casse : la confiance n'existe pas. La question 43 (lequel des trois nombres de
> stock du fournisseur est du stock) est encore une supposition sur le modèle de données de
> quelqu'un d'autre. Le mode du compte peut passer en réel sans que personne ne le
> remarque. Acheter tout seul par-dessus une question 43 non répondue, c'est acheter contre
> un nombre dont nous ne savons pas si c'est du stock.

---

## Comment ça marche, concrètement

### 1. Le panier est déduit, jamais saisi

Chaque quantité vient d'une ligne de commande et d'une grille de tailles, et le code le
**prouve** au lieu de le supposer : chaque ligne du panier porte les prétentions qui l'ont
constituée, et leur somme doit valoir la ligne. Un test pur et un test d'intégration
l'assèrent tous les deux.

Une ligne dont l'article ne peut pas être identifié est **refusée par son nom** et bloque
l'achat. Les quatre refus possibles, avec leur phrase à l'écran :

| Situation | Ce que l'opérateur lit |
|---|---|
| Le produit ne déclare aucun textile nu | « Aucun textile nu n'est déclaré sur ce produit » |
| Le coloris du studio n'est associé à rien | « Le coloris X n'est associé à aucun coloris du fournisseur » |
| Le fournisseur ne vend pas cette taille dans ce coloris | « Le fournisseur ne vend pas la taille X en Y » |
| La ligne n'a pas de grille de tailles | « Impossible de savoir quelles tailles acheter » |

Rien n'est approximé à la taille ou au coloris le plus proche.

### 1 bis. Ce qui est acheté est ce qui a été VENDU

La référence du textile nu et le coloris fournisseur sont **gelés sur la ligne de commande
au moment de la vente**, pas relus au moment de l'achat.

La première version les relisait sur la fiche produit, des jours après la vente et souvent
après l'impression du film. La passe adverse l'a reproduit sur le miroir : un gestionnaire
change une référence en fin de vie, la 00142 devient la 00517, le nom de coloris « Navy »
existe sur les deux parce que `pa_couleur` est un seul attribut global partagé par tous les
styles importés, rien ne refuse, et vingt polos sont achetés pour une série dont le film
est imprimé pour des t-shirts. Dans le catalogue du miroir, « Navy » est porté par 4 styles
et « White » par 5 : la collision est le cas ordinaire, pas un cas tordu.

Gelé, le panier achète ce qui a été vendu, et une fiche produit qui a bougé depuis est une
différence que l'écran peut **nommer** au lieu d'une substitution que personne ne voit avant
l'ouverture des cartons.

Même famille : quand un coloris et une taille désignent **deux** articles d'un même style,
le panier refuse au lieu de prendre le premier que WooCommerce rend. Deux noms de coloris
du fournisseur peuvent se réduire au même suffixe public, et l'importateur publie alors les
deux articles avec le même terme de coloris.

### 2. Le lien entre un produit et son textile nu

Une fiche produit déclare désormais deux choses de plus, au même endroit et pour la même
raison que le vêtement du studio qu'elle déclarait déjà :

- **la référence du catalogue** sur laquelle elle est imprimée (« 18001 ») ;
- **la correspondance des coloris**, du coloris que le client choisit dans le studio vers
  le nom que le fabricant emploie (« Noir » vers « Black »).

La taille correspond **par son nom exact**. Rien n'est déduit de la numérotation du
fournisseur, qui est référence + coloris + un chiffre avec la même table des tailles dans
tous les coloris : une référence et une taille pourraient donc être transformées en numéro
d'article par concaténation, et ce numéro serait deviné.

Cette déclaration referme aussi un trou du moteur de coût : le coût textile d'une commande
du studio était **inconnu**, donc son prix plancher n'était qu'un minimum. Il vient
maintenant de l'article réel, **taille par taille**, parce qu'un 2XL ne coûte pas le prix
d'un M.

### 3. Le port est partagé, pas répété

Six commandes achetées ensemble, c'est **un** port. Il est réparti par la même règle du
plus fort reste que le film, pondérée par ce que les textiles de chaque commande coûtent,
et c'est littéralement la même fonction : deux répartiteurs ne sont jamais d'accord au
centime près, et ce centime est ce qu'une facture fournisseur ne réconcilie pas.

**Mesuré sur la semaine de six commandes de la séance 07** (`node scripts/purchase-bench.mjs`,
tarifs relevés en direct le 19 août 2026, référence 18001 en Black) :

| | Achat groupé | Commande par commande |
|---|---|---|
| Textile, 67 pièces | 278,05 EUR | 278,05 EUR |
| Port fournisseur | 0,00 EUR | 48,00 EUR |
| **Total HT** | **278,05 EUR** | **326,05 EUR** |

**48,00 EUR d'économie sur la semaine, et c'est entièrement du port.** Le textile coûte le
même prix des deux côtés : un article se vend à l'unité, il n'y a pas de dégressif à
gagner. Ce sont six ports de 8,00 EUR qui deviennent zéro, parce que le panier groupé passe
le franco de 200,00 EUR alors qu'aucune commande seule ne l'atteint.

À comparer aux **75,00 EUR** que le groupage du **film** fait gagner sur la même semaine
(remesuré le 01/09/2026 sur le tarif à la feuille de la question 04 ; c'était 121,41 EUR
sous le rouleau). La leçon est la même que celle de la séance 07, et elle est maintenant
totale des deux côtés : ce que le groupage fait gagner, ce sont des **frais fixes**, pas de
la matière. Sur le film il ne reste plus que ça, à l'euro près.

### 4. Envoyer est un acte unique, et jamais rejoué

L'interface du fournisseur **ne permet pas de relire une commande** (vérifié le 19 août
2026 : la route de commande interrogée en lecture répond `<response>0</response>` et il n'y
a pas d'action `get_orders`). Nous ne pouvons donc pas demander « est-ce que cette commande
existe déjà ? ».

Alors l'état « envoi en cours » est écrit **et enregistré avant** l'appel. Un processus qui
meurt en tenant la requête laisse un dossier qui dit « envoi incertain », et l'envoi refuse
de repartir. Cela coûte un coup de téléphone au fournisseur ; l'inverse coûte une seconde
livraison, payée, sur une série dont le film est déjà acheté.

**Quatre issues et non deux :**

| Issue | Ce que ça veut dire | Ce que fait la boutique |
|---|---|---|
| **acceptée** | commande créée, toutes les lignes prises | rien à faire |
| **commandée en partie** | commande créée, **des lignes refusées** | la série sera incomplète, les articles refusés sont affichés |
| **refusée** | rien n'existe chez lui | les commandes retournent au panier |
| **incertaine** | la réponse s'est perdue, ou elle nomme une commande créée **et** une erreur globale | les commandes restent rattachées, un opérateur va vérifier |

La deuxième vient de la passe adverse : une commande acceptée avec des lignes refusées
était affichée comme entièrement « Commandée », et le détail des refus était enregistré
puis masqué par l'écran. La pénurie se découvrait à l'ouverture des cartons, à côté d'un
film déjà imprimé.

Et une réponse qui nomme un numéro de commande n'est **jamais** « refusée », quoi qu'elle
porte d'autre : une commande refusée libère ses commandes clients, qui peuvent alors être
achetées une seconde fois. Un numéro de commande est la preuve que quelque chose existe, et
il l'emporte sur le reste.

**Un envoi mort a une sortie.** L'état « envoi en cours » n'en avait aucune : envoyer,
annuler et recevoir refusaient tous cet état, donc le dossier restait bloqué pour toujours,
ses commandes rattachées pour toujours, et l'écran de l'atelier continuait à les compter
comme achetées. Un « envoi en cours » plus vieux que cinq minutes devient donc **« envoi
incertain »** à la lecture, parce qu'une requête dont le délai est de quarante secondes
n'est plus en vol au bout de cinq minutes. Et un envoi incertain a une sortie, qui est une
affirmation humaine parce que la boutique ne peut pas la vérifier : **« Le fournisseur n'a
rien reçu »**, qui libère les commandes et enregistre qui l'a dit et quand.

Chaque envoi porte une **clé d'idempotence** (`TS-A{n}-{8 hexadécimaux}`) qui voyage aussi
comme la référence de commande du fournisseur, donc un doublon est reconnaissable de son
côté par un humain. Elle ne peut pas l'empêcher, et ce document ne prétend pas le
contraire.

### 5. Le mode du compte est une croyance vérifiée

Pour envoyer, l'opérateur **recopie le mode affiché** : « test » ou « réel ». Ce mot voyage
avec la commande, le Worker relit le vrai mode du compte et **refuse** si les deux diffèrent.

Un compte basculé en réel entre l'écran et le clic ne peut donc pas transformer une
confirmation en vraie commande. C'est exactement l'accident que la question 22 redoute.

**Au 19 août 2026 le compte est en mode test**, relevé en direct. Ce n'est pas une réponse
à la question 22, c'est un fait mesuré : le mode peut changer chez le fournisseur sans que
nous le décidions, et c'est pourquoi il est relu à chaque envoi.

### 5 bis. Deux secrets, parce qu'un seul dépensait de l'argent

`ADMIN_TOKEN` ouvre toutes les routes du Worker, et l'un de ses porteurs est une tâche de
nuit sur la boutique qui lit le catalogue. Le jeton qui importe des photographies de
produits était donc aussi celui qui pouvait passer une commande d'achat, pour n'importe
quel article et n'importe quelle quantité, et c'est le jeton en lecture seule qui vit dans
un WordPress sur hébergement mutualisé.

`POST /api/fr/order` demande donc **un second secret**, `FR_ORDER_TOKEN`, sur un en-tête à
lui (`X-Teeshoop-Order-Token`), en plus de `ADMIN_TOKEN`. La boutique le garde dans une
constante distincte (`TEESHOOP_ORDER_TOKEN`), que l'importateur de catalogue ne porte
jamais.

Cette route n'accepte par ailleurs que la forme `Bearer`. Le contrôle d'administration
accepte aussi `Basic`, pour qu'un navigateur puisse ouvrir `/admin.html` avec sa propre
fenêtre de connexion : un navigateur qui a fait cela rejoue l'identifiant sur toutes les
requêtes vers cette origine, y compris celles qu'une page d'un autre site lui fait faire.
L'en-tête personnalisé bloque déjà ce cas (une requête inter-origines qui le porte demande
un contrôle préalable, et cette route n'en accorde aucun), mais une route qui dépense de
l'argent ne doit pas reposer sur un second mécanisme quand refuser la forme navigateur
coûte une ligne.

```
wrangler secret put FR_ORDER_TOKEN
npm run wp:cli -- config set TEESHOOP_ORDER_TOKEN <valeur> --type=constant
```

### 6. Le dernier verrou est vide

`FR_CUSTOMER_NR` n'est configuré nulle part, donc **aucune commande ne peut partir
aujourd'hui**, même confirmée. Le Worker répond 503 et ne construit aucun document.

Le code **devinait** ce numéro auparavant : le login du webservice a la forme
`{compte}-{n}-{jeton}`, et il en prenait les premiers chiffres en signalant qu'il l'avait
fait. Un numéro deviné qui décide quel compte est facturé est exactement ce que ce projet
s'interdit. Le repli a été supprimé.

Nous avons essayé de confirmer la devinette auprès du fournisseur, en mode test, avec un
document dont la seule ligne nomme un article qui n'existe pas. **C'est non concluant, et
`scripts/fr-verify.mjs` le dit** : la passerelle répond exactement la même chose à un
numéro de client délibérément faux qu'au nôtre, parce qu'elle refuse sur l'article avant de
juger le compte. Le numéro reste une question pour l'associé.

Quand il l'aura donné :

```
wrangler secret put FR_CUSTOMER_NR
```

Rien à coller ici, rien à coller dans un message : la commande demande la valeur sur son
entrée standard.

---

## Le stock

**Un stock affiché est une observation datée, jamais une réservation.** C'est la seule
règle de fond que la Bible donne sur le sujet (chapitre 5) et le code la suit à la lettre :
chaque quantité porte l'horodatage que le fournisseur a publié avec elle.

### La cadence

Le relevé complet du catalogue tient en **un seul appel** au fournisseur. Mesuré le 19 août
2026, sur le compte réel :

| Filtre | Lignes | Taille | Durée |
|---|---|---|---|
| `18001____` (une référence) | 25 | 529 o | 282 ms |
| `1800_____` (une centaine) | 541 | 10,8 ko | 95 ms |
| `_________` (tout) | 46 592 | 908 ko | 674 ms |

C'est ce qui rend le chapitre 4 tenable : « stock : plusieurs fois par jour si l'API le
permet ». Le rafraîchissement tourne **six fois par jour**, une ligne de cron :

```
0 2,6,10,14,18,22 * * *  cd /home/xxx/public_html && wp teeshoop stock rafraichir --discret
```

La forme qui aurait semblé naturelle (un appel par référence) est 460 invocations du Worker
pour un nombre qui bouge en continu, et un appel par article en est 26 399.

### Ce que le client lit

Jamais un chiffre. Trois mentions, et la troisième est celle que personne ne pense à
construire :

| Ce que nous savons | Ce que le client lit |
|---|---|
| Relevé de moins de 24 h, stock positif | **Disponible** |
| Relevé de moins de 24 h, stock nul | **Rupture, nous consulter** |
| Relevé plus vieux que 24 h, ou aucun relevé | **Délai à confirmer** |

La deuxième n'est **pas** le mot de la question 11, qui dit « délai allongé ».
L'importateur pose `backorders = no` sur chaque article, donc WooCommerce refuse la
commande qu'un « délai allongé » inviterait à passer : la formulation suit le
comportement, parce que l'inverse est une promesse que la boutique ne tient pas. L'écart
est enregistré dans `H-Q11-STOCK-CHIFFRE`.

L'écran de l'atelier, lui, en dit **quatre**, parce qu'il en a besoin de quatre : « en
stock », « n seulement », « trop ancien » et « horloges décalées ». La première version
n'en disait que deux et a annoncé « trop ancien » sur un relevé de quatre minutes, ce qui
envoie un opérateur rafraîchir quelque chose qui ne l'était pas.

Publier un chiffre transformerait l'entrepôt du fournisseur en notre promesse, ce que la
question 11 laisse à l'associé. La fenêtre de 24 heures est à nous et elle est enregistrée
(`H-Q11-FRAICHEUR-STOCK`) : au-delà d'une journée de commandes des autres clients du
fournisseur, son nombre ne dit plus rien de son entrepôt.

Un article que le relevé n'a pas mentionné **garde sa date** et vieillit tout seul. C'est
le point : un balayage qui daterait tout ce qu'il n'a pas vu transformerait un article
retiré du catalogue en article que la boutique annonce disponible.

### L'horodatage n'est pas en UTC

Mesuré le 19 août 2026 : une même réponse portait `14:49:09` en UTC, écrit par nous, à côté
de `16:49:10` écrit par le fournisseur pour le même instant. Il écrit **son** heure murale,
qui est la nôtre. WordPress met le fuseau par défaut de PHP à UTC, donc `strtotime()` sur
cette chaîne la lit deux heures dans le passé en été et une en hiver.

Sous une fenêtre de 24 heures cela ne casse jamais tout à fait, ce qui est exactement
pourquoi cela serait resté. La chaîne est donc lue explicitement dans le fuseau de la
boutique.

---

## Le rapprochement des coûts

L'écran des achats affiche, **par commande** : ce que ses textiles coûtent au moment où on
les achète, contre ce que son rapport de marge gelé avait supposé, et l'écart.

Un fournisseur qui augmente un t-shirt de huit centimes ne se voit nulle part et déplace
tous les prix planchers de la boutique.

**Ce qui n'est pas là et ne peut pas l'être aujourd'hui** : ce que le fournisseur a
réellement **facturé**. Son interface ne publie aucune facture. Le troisième nombre viendra
de son document, saisi ou récupéré à la réception, et le chapitre 6 de la Bible le demande
(« écart ; coût réel ; facture fournisseur »). L'écran le dit plutôt que de laisser croire
que le rapprochement est complet.

La question **47** est ajoutée à l'associé : que fait-on quand le prix d'achat augmente
entre le devis et l'achat ? La Bible ne le dit nulle part, et mises bout à bout ses règles
font que Teeshoop absorbe la hausse et reprend une part de commission au commercial pour
une hausse qu'il n'a pas causée.

---

## Le second fournisseur

Le chapitre 6 demande un « adaptateur par fournisseur », et que le métier ne dépende pas des
noms de champs de l'un d'eux. Ce qui manquait n'était pas l'abstraction du **coût** (le
moteur demande déjà ce qu'un textile coûte, pas ce qu'un fournisseur facture) mais le
**discriminant**.

Chaque article importé porte donc le code de l'adaptateur qui l'a écrit. Un code, jamais un
nom : `scripts/php-guard.mjs` tient tous les noms de fournisseurs hors de l'extension, et le
code est scellé avec le numéro d'article et le prix d'achat parce qu'il partitionne le
catalogue par fournisseur, ce qui est la même information qu'un concurrent voudrait.

Le panier groupe par adaptateur, refuse d'en mélanger deux, et seul un adaptateur qui a une
voie de transmission peut être envoyé. Les autres s'exportent en CSV, ce qui est aussi le
repli du jour où le Worker ou le webservice est en panne.

Un second fournisseur demande : un adaptateur dans le Worker, un code ici, et une route
d'envoi. Rien dans `Purchase.php` ne change.

---

## Ce que la séance n'a pas construit, et pourquoi

**Aucune date d'approvisionnement textile.** L'atelier sait quand commander le **film** et
ne sait pas quand commander les **vêtements**, parce que personne n'a jamais mesuré le
délai du fournisseur : ni la Bible, qui n'en donne aucun dans ses huit chapitres, ni
l'interface du fournisseur, qui n'en publie pas, ni nous, qui n'avons jamais passé de
commande. C'est la question **46**, ajoutée par cette séance et marquée bloquante, et c'est
un refus enregistré (`H-Q46-DELAI-TEXTILE`) et non un oubli.

La séance 07 avait mesuré 6 jours ouvrés de travail incompressible contre 4 jours promis en
urgence. Ces 6 jours **ne comptent pas** l'acheminement des vêtements nus.

**Aucune réservation de stock.** Le fournisseur n'en propose pas et la Bible n'en décrit
aucune. Entre le relevé et la commande, il sert d'autres clients.

**Ce que le fournisseur annonce, en revanche, est lu et affiché.** Une ligne dont il n'a
pas assez porte la date de réapprovisionnement qu'il publie, avec la quantité annoncée, ou
« rien d'annoncé ». C'est la seule date de tout ce fichier, et elle vient de lui.

**Aucune règle de rupture automatique.** La question 11 propose « substitution, changement
de couleur, fractionnement ou remboursement partiel après accord client ». Les quatre
arrivent après le paiement, donc chacun est une modification unilatérale d'un contrat
conclu sur un bien personnalisé. Le panier **signale** la rupture, chiffre à l'appui, et
laisse la décision à un humain.

**Aucune facture fournisseur.** Voir plus haut.
