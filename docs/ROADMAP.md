# Feuille de route de teeshoop.com

État au 14 août 2026. Ce document dit **où en est le projet** et **ce qu'il reste à
faire**, dans l'ordre. Il est volontairement court : le détail vit dans le code et dans les
messages de commit.

---

## Ce qui est fait

**Le socle et la sécurité (R0).** Le Worker Cloudflare est fermé par défaut : sans le
secret `ADMIN_TOKEN`, tout `/api/fr/*` et la page `/admin` sont refusés. Le bundle client
a été séparé du bundle admin : nos prix d'achat, notre modèle de coût film et le
formulaire d'identifiants WooCommerce ne partent plus dans le JavaScript d'un visiteur, et
deux garde-fous automatiques empêchent la régression. Une faille de cache qui exposait nos
prix d'achat par une simple requête a été fermée. Le premier affichage du studio a été
réduit de 58 % (React voyageait à l'intérieur du morceau three.js).

**L'autorité de prix (plugin `teeshoop-core`).** Le prix payable est calculé en PHP, sur le
serveur. Il n'y a **aucun champ prix** dans la requête d'ajout au panier : le panier
enregistre les choix du client et recalcule le prix à chaque passage. Tout est en centimes
entiers ; « 14,50 » saisi à la française est lu correctement. Le chapitre 1 de la Bible est
encodé, **avec une formule corrigée** : le prix plancher publié majore le *coût* du taux de
commission alors que la commission porte sur la *marge*. À 250 € de coût, 100 € de marge
cible et 40 % de commission, le vrai plancher est **416,67 €** et non 583,33 €. Le test
garde les deux versions côte à côte.

**Le DTF : chaque visuel est mesuré par son encre.** Un visuel était mesuré par le rectangle
dans lequel il avait été déposé, si bien que les marges transparentes d'un logo client étaient
achetées en film et facturées au client. Mesuré sur une commande de 20 vêtements avec des
fichiers clients réalistes : **220 cm de rouleau ramenés à 60 cm**, 1,28 m² de film ramenés
à 0,35 m². Au tarif de lancement de la Bible (17 € HT/mètre linéaire en France) : **37,40 €
ramenés à 10,20 €**. C'est exactement ce que demande le chapitre 1 : « largeur et hauteur
de chaque **visuel** ».

La même mesure fixe désormais le prix client, en cm², ce qui corrige trois surfacturations :
les marges transparentes, l'espace vide entre deux visuels d'une même face (59 % de la
facture sur le design d'exemple), et un visuel débordant de la zone d'impression qui était
facturé en entier.

**La remise du design.** Le fichier d'un client n'existait que dans son propre navigateur.
Il est maintenant déposé sur R2 via le Worker, et WordPress vérifie son existence avant
d'accepter la ligne de panier : une commande impossible à imprimer est refusée avant le
paiement, pas découverte après. Vérifié de bout en bout : identifiant réel → panier à
271,75 € calculé par le serveur ; identifiant inventé → refusé.

**La boucle est fermée : du studio au panier.** Un visiteur ouvre le studio sur une fiche
produit, dessine, clique « Ajouter au panier », et une ligne WooCommerce apparaît avec un
identifiant de création vérifié et un prix que WordPress a calculé lui-même. Vérifié de bout
en bout par `npm run verify:wp-e2e` : 29 assertions, contre un vrai navigateur, un vrai
Worker et un vrai panier. Le prix affiché dans le studio, celui enregistré sur la ligne et
le sous-total du panier sont le même nombre, et c'est celui de `Pricing::quote()`.

Deux entrées de prix ont cessé d'arriver du navigateur au passage. **Le vêtement** est
désormais déclaré sur la fiche produit : il décide du prix du textile nu, et une requête
pouvait auparavant annoncer « custom » (textile à 0 EUR, le client fournit le sien) sur un
sweat et emporter 27 EUR de textile pour rien. **Les surfaces imprimées** viennent du
fichier de création que le Worker a confirmé, donc la facture et le film mesurent la même
chose. Trois autres défauts ont été trouvés en regardant la vraie page : les devis
échouaient silencieusement sur une boutique aux permaliens simples, le panier annonçait une
remise de 2 115,50 EUR qui n'a jamais existé (prix de référence fictif, interdit en France),
et une boutique réglée en dollars affichait des euros avec un dollar devant.

**La fiche produit répond avant l'éditeur.** Un acheteur qui arrive sur une fiche sait
maintenant, sans ouvrir le studio : ce qu'est le vêtement, ce qu'il paie **à sa quantité**,
**jusqu'où il peut imprimer en centimètres**, et comment obtenir un prix pour deux cents
pièces. La grille prix par quantité est celle de `Pricing::grid()`, donc celle du panier,
et ses colonnes sont **déduites des paliers de remise** au lieu d'être choisies : une
colonne ne peut pas laisser croire à un palier qui n'existe pas. Le « à partir de » est lu
dans la grille imprimée juste en dessous, avec la quantité qui l'atteint : chez notre
principal concurrent, ce chiffre est le prix à 500 pièces, si bien qu'un acheteur de vingt
découvre 36 % d'écart en descendant la page.

Les zones d'impression sont publiées en centimètres. **Ni mistertee.fr ni tostadora.fr ne
publient une seule dimension d'impression sur une fiche produit** (vérifié le 14 août
2026) : c'est notre différence, parce que nous facturons l'encre et pas le fichier. Les
chiffres viennent des définitions du studio, pas d'une saisie : un générateur les extrait
et un test échoue si les deux divergent.

**Le devis est un dossier avec un état**, pas un e-mail. Cinq états, pas les vingt-cinq de
la Bible, dont au moins six sont des tâches et non des états de commande (le document le
dit lui-même trois lignes plus loin). Le formulaire est ouvert, parce qu'un prospect ne
peut pas s'authentifier, et il est tenu par un jeton signé à durée limitée, un piège à
robots, une durée minimale de remplissage et une limite par adresse : l'adresse elle-même
n'est jamais enregistrée.

**Un vrai bug de production trouvé en rendant le miroir conforme.** WooCommerce ne construit
un panier que pour ce qu'il considère comme une requête de site, et il le décide en
cherchant le préfixe REST dans l'adresse. Avec les permaliens simples d'une installation
neuve, notre route d'ajout au panier ne contient pas « wp-json » : WooCommerce chargeait un
panier et tout fonctionnait. Avec les permaliens propres, ceux d'o2switch, **chaque ajout au
panier répondait 503**. Toute la séance 01 avait été vérifiée verte sur la seule
configuration où le défaut est invisible.

**Le catalogue fournisseur est dans la boutique.** 459 références et 26 392 articles publiés
sur les 463 et 26 399 que le fournisseur liste comme imprimables, avec
leurs coloris, leurs tailles, leur grammage, leur composition, leur stock et notre prix
d'achat. Une référence est **un produit variable**, un article vendu par le fournisseur est
**une variation** : construites depuis la liste d'articles et jamais depuis le produit
cartésien coloris × taille, parce que 3 481 de ces combinaisons (11,6 %) n'existent pas et
seraient autant de commandes impossibles à honorer.

L'import est **idempotent par comparaison, pas par empreinte** : chaque champ est relu et
comparé, et rien n'est écrit tant que rien n'a bougé. Cette exigence a trouvé deux défauts
qu'une empreinte aurait cachés pour toujours : `_global_unique_id` est devenu une meta
interne de WooCommerce 9.2, donc sa relecture rendait toujours une chaîne vide ; et les
options d'un attribut de taxonomie reviennent triées par nom de terme et non dans l'ordre
où elles ont été écrites, si bien qu'une comparaison de séquences trouvait une différence
toutes les nuits et réécrivait le résumé d'attributs des 366 variations d'un produit.

Il est **reprenable** : `--duree=1800` fait une demi-heure de travail et s'arrête
proprement, et le curseur est écrit dans la même transaction que la référence, donc un
processus tué rejoue la référence entière au lieu d'en laisser une moitié. Mesuré :
0,24 s par article à la création (style 01542, 299 articles, une transaction) contre
0,38 s sans transaction (style 18009, 366 articles), et 5 ms pour revérifier un article
inchangé. Deux styles différents, donc un ordre de grandeur et non un A/B contrôlé.

**Notre prix d'achat ne sort par aucune porte** : ni l'API REST authentifiée (produits et
variations), ni l'API Store publique, ni l'export CSV avec les meta personnalisées, ni le
JSON des variations envoyé au navigateur. `npm run verify:wp-catalogue` le prouve en
retirant le verrou et en exigeant que le même contrôle trouve la fuite.

**Le prix de vente, lui, n'est pas inventé.** La Bible donne la formule et laisse le taux
de marge à décider : tant que personne ne l'a fixé (question 42), aucun prix n'est écrit et
le catalogue est consultable sans être commandable.

**L'outillage.** Un miroir local de la production (WordPress 7.0.4 + WooCommerce 11.0.1 en
docker, **versions épinglées** sur celles réellement mesurées sur le serveur) que l'on peut désormais **reconstruire depuis le dépôt** (`wp teeshoop
provisionner`), 147 tests JavaScript, 177 tests PHP purs, 45 tests d'intégration WooCommerce,
une vérification de bout en bout du parcours d'achat à 66 assertions qui va désormais
jusqu'à la facture, un garde-fou qui interdit à un prix d'achat, un nom de fournisseur ou
un tarif film d'atteindre un gabarit PHP, et des scripts de vérification qui font tourner
le vrai code dans un vrai navigateur.

**Encaisser (séance 04).** Le régime de TVA n'est pas une constante : c'est une suite de
**périodes datées**, avec un mode franchise qui supprime toute ligne de taxe et fait
apparaître « TVA non applicable, article 293 B du CGI ». Aucun seuil n'est écrit dans le
code, parce que les seuils sont la réponse du comptable. La livraison est facturée à la
grille publique Colissimo au poids, l'emballage compris, avec un franco, et le coût d'une
livraison offerte reste enregistré sur la commande : « offerte » est une remise, pas un
coût nul. La facture porte un numéro continu attribué en une seule instruction SQL
(six processus concurrents, 150 numéros, aucun doublon et aucun trou ; la même fonction
écrite en lire-puis-écrire en perd 48), elle est **gelée à l'émission** parce que
`calculate_taxes()` de WooCommerce reprend une commande déjà passée au taux du jour, et
elle est relue par poppler, qui ne partage pas une ligne avec le code qui l'écrit.
L'identité légale du vendeur est **vide** et le restera : en production une facture
incomplète est refusée, ailleurs elle sort marquée « document non conforme ».

---

## Ce qu'il reste : seize séances

Le détail exécutable de chacune vit dans `prompts/` (non versionné : ce sont des
instructions de travail, elles changent plus vite que le code).

| # | Séance | Bloquée par |
|---|---|---|
| ~~01~~ | ~~Boucler la boucle : du studio au panier WooCommerce~~ **faite** | - |
| ~~02~~ | ~~Fiche produit, grille de prix, demande de devis~~ **faite** | - |
| ~~03~~ | ~~Catalogue : Falk&Ross vers WooCommerce, à l'échelle~~ **faite** | - |
| ~~03b~~ | ~~Le registre des hypothèses~~ **faite** | - |
| ~~04~~ | ~~Paiement : Stripe, TVA, livraison, facture~~ **faite** | - |
| 05 | Moteur de coût, prix plancher, commissions | 03b |
| 06 | BAT, cycle de vie de la commande, e-mails | 04 |
| 07 | Production : imbrication du film entre commandes | 06 |
| 08 | Commande fournisseur et stock | 03, 07 |
| 09 | Le site : accueil, navigation, système de design | 02 |
| 10 | Le studio en vitrine : 3D et mockups | 09 |
| 11 | Référencement, contenu, données structurées | 09 |
| 12 | Juridique, RGPD, accessibilité | 09 |
| 13 | Performance, sécurité, supervision | 09, 10 |
| 13b | Les réponses de l'associé, et redire la vérité | 13 |
| 14 | Déploiement : préproduction, pipeline, purge de la démo | 13b |
| 15 | Répétition générale et mise en ligne | 14 |

**Seules les séances 14 et 15 touchent au serveur o2switch, et leurs accès sont
désormais en place.** Tout le reste se construit et se vérifie sur le miroir local.

---

## Ce qui bloque, et qui peut le débloquer

**Les accès ne bloquent plus rien depuis le 14/08/2026.** SSH, clés WooCommerce,
compte administrateur et préproduction sont en place et ont été essayés un par un
(détail et méthode dans `ACCES-REQUIS.md`). La demande d'accès à cPanel a été
**retirée** plutôt qu'accordée : les quatre opérations qui la motivaient passent toutes
par SSH. Ce qui reste bloque pour une autre raison, et personne d'autre que l'associé
ne peut le lever.

| Blocage | Qui | Détail |
|---|---|---|
| **Le régime de TVA** | associé | Question 17 et constat 6. La boutique a encaissé 15 commandes (465,79 EUR, nov. 2024 à avr. 2025) **taxes désactivées**. Depuis la séance 04 les deux régimes sont construits et la bascule est une date à saisir : ce qui manque n'est plus du code, c'est la réponse. Les 15 commandes, elles, ne sont facturables par le site sous aucun régime, parce qu'aucune période ne couvre leur date |
| La vraie grille tarifaire | associé | Questions **06** (taux de marge) et **03** (grilles d'achat réelles), sa forme publique étant la **08**. Les prix actuels sont des **valeurs de démonstration**, enregistrées une par une dans `docs/hypotheses.json`. Ce tableau renvoyait à la question 04, qui porte sur les tarifs DTF fournisseur et ne tranche aucun prix de vente |
| **Le taux de marge sur un textile nu** | associé | Question 42. Les 26 399 articles du catalogue sont importés avec leur coût réel et **sans prix de vente** : consultables, non commandables, tant que le taux n'est pas fixé |
| Clés Stripe (test puis production) | associé | Séance 04. L'extension officielle est branchée et l'alarme distingue un compte de test d'un compte réel par le préfixe de la clé, pas par la case à cocher, qui se contredit elle-même sur une configuration jamais enregistrée |
| L'identité légale complète et le RCS | associé | Questions 17 et **45**. Rien n'est facturable sans, et rien n'est inventé à la place |
| Une plateforme de facturation électronique | associé | Constat 7. Obligatoire **en réception au 1er septembre 2026**, quelle que soit la taille de l'entreprise. Ce n'est pas du développement, c'est une démarche |
| Compte Brevo | associé | Séance 06 |
| `FR_CUSTOMER_NR` | associé | Séance 08. Absent des secrets, donc aucune commande fournisseur n'a jamais pu partir |

### Ce qui a été décidé le 18/08/2026 : avancer quand même

L'associé n'est pas disponible pour répondre, et attendre coûte plus cher que corriger.
Les séances 04 à 13 sont donc construites **sur les hypothèses par défaut** écrites dans
`QUESTIONS-ASSOCIE.md`, sous une condition en deux séances nouvelles.

**03b a installé la condition.** Le registre est `docs/hypotheses.json` : **28 lignes**, une
par valeur supposée, avec son **unique** emplacement dans le code, ce qu'elle atteint (un
client, un fournisseur, une presse) et les mesures qui deviendraient fausses si elle
bougeait. `scripts/hypotheses-guard.mjs` est dans `npm run ci` et échoue quand le registre
et le code divergent, quand une valeur acquiert une seconde copie, quand une question
marquée bloquante n'a aucune ligne, quand la phrase française d'une ligne ne dit plus le
nombre que le code applique, et quand une hypothèse qu'un client rencontre n'a aucune
formulation française à l'écran. Les six contrôles ont été cassés un par un, sur les vrais
fichiers, pour vérifier qu'ils échouent, et `--self-test` les recasse à chaque exécution de
la chaîne. Un exemple mesuré : passer le t-shirt nu de 9,50 à 9,90 EUR fait échouer trois
contrôles à la fois. **Les 18 questions bloquantes sont toutes traitées** : onze par une
ligne, sept par un motif écrit de non-applicabilité.

Il ne compare pas des fichiers texte : il **fait tourner les deux implémentations**. La
configuration de prix est obtenue en appelant `Pricing::default_config()` en php, la table
du studio en la compilant avec esbuild et en l'important. C'est ce qui permet de tenir la
seule vraie duplication du prix, `src/content/pricing.ts`, qui répétait cinq nombres sans
que rien ne les compare.

Trois copies réelles ont été supprimées au passage : le taux de TVA et le prix du t-shirt
de démonstration étaient réécrits à la main dans la commande de provisionnement
(`Cli.php`), qui les lit désormais depuis l'autorité, et deux notes d'administration
renvoyaient l'associé à la mauvaise question. Deux valeurs ont reçu un nom pour pouvoir
être désignées : `Catalogue::PRINTABLE_FAMILIES` et `Catalogue::STOCK_INDEX`.

**Ce qui a été livré n'est pas toujours l'hypothèse par défaut écrite**, et le registre le
dit ligne par ligne. Les écarts qui coûtent le plus cher à refermer, dans l'ordre : aucun
**minimum de commande** n'est appliqué alors que la question 01 en annonce un « bloquant à
la validation du panier » ; la **TVA** est une constante alors que la question 17 exige
expressément une période datée avec un mode franchise ; le catalogue publie **459
références et trois familles** au lieu des 300 et cinq familles annoncées ; la **grille
publique** a cinq colonnes au lieu de six et accorde 35 % de remise en autonomie là où la
question 06 en plafonne la remise à 15 % ; la **découpe en visuels** se déclenche sur une
géométrie et non sur le seuil de 100 cm² d'économie annoncé ; et les **17 EUR le mètre
linéaire** ne sont écrits dans aucun code exécutable, le module DTF chiffrant sur des
tarifs publics relevés, très inférieurs.

**13b la solde**, entre la 13 et la 14, ce qui est la bonne couture : tout ce qui précède
est local et réversible, la 14 touche le vrai domaine et la 15 encaisse de l'argent réel.
Elle confronte chaque réponse au registre, applique les changements par ordre de portée,
**remesure** ce qui dépendait d'une valeur modifiée au lieu de le réaffirmer, réaccorde ce
que le site promet en public avec ce que l'atelier peut tenir, et installe le contrôle qui
refuse la mise en ligne tant qu'une hypothèse bloquante atteint encore un client.

`QUESTIONS-ASSOCIE.md` contient 44 questions auxquelles seul l'associé peut répondre, dont
18 marquées bloquantes. Q06 (les taux de marge) et Q03 (les grilles d'achat réelles)
conditionnent une grande partie de la séance 05. Trois viennent d'être
ajoutées par la séance 02 : la durée de validité d'un devis (la Bible impose la mention et
ne donne aucune durée, et c'est un engagement ferme en droit français), le fait que la
commission d'un commercial figure ou non sur le document que le client reçoit, et la durée
de conservation d'une demande de devis sans suite.

---

## Les exceptions assumées

Ce qui précède attend une réponse de l'associé. Ce qui suit n'attend personne : ce sont des
écarts **décidés**, avec leur raison, ce qui les referme et la séance qui devrait s'en
occuper. Ils sont ici parce qu'un écart non écrit devient au choix un bug que l'on
redécouvre, ou une habitude que l'on croit voulue.

La règle pour la séance qui les traite : **ne pas refermer un de ces écarts sans relire la
raison**. Plusieurs sont des refus délibérés, pas des oublis.

**Ce tableau ne contient plus ce que le registre tient.** Tout écart qui remonte à une
question de `QUESTIONS-ASSOCIE.md` est désormais une ligne de `docs/hypotheses.json`, avec
un contrôle derrière : le catalogue consultable et non commandable est `H-Q41-CATALOGUE-CONSULTABLE`
et `H-Q42-MARGE-TEXTILE-NU`, les trois familles publiées sont `H-Q09-FAMILLES`. Le recopier
ici en ferait deux vérités qui divergeraient. Ce qui reste ci-dessous est ce que le registre
ne peut pas porter : des arbitrages d'ingénierie qui n'attendent la réponse de personne.

| Écart | Pourquoi il a été choisi | Ce qui le referme | Séance |
|---|---|---|---|
| **Les photos par coloris publient le nom de fichier du fournisseur** (`/media/blank/picture/001_42_000_f-2020_01.jpg`, soit le style et le coloris) | Les copier coûte 267 Mo, ~650 Mo après vignettes, et 1 h 30 d'import. Les trois options sont chiffrées dans `docs/CATALOGUE.md` et le choix a un prix, donc il appartient à l'associé | Une des trois options. En attendant, le contrôle **épingle la porte à la largeur exacte** de cette URL : ce motif ailleurs sur une surface client fait échouer la vérification | 09 ou perf |
| **378 ms par page de liste pour n'afficher aucun prix.** `get_price_html()` parcourt les articles de chaque produit variable, 23,6 ms par produit, seize par page | Tant qu'aucun prix n'est écrit, ce calcul produit une chaîne vide. Le corriger avant de connaître le prix de vente, c'est optimiser une forme qui va changer | Soit ne pas afficher de prix en liste tant qu'il n'y en a pas, soit stocker la fourchette sur le produit parent à l'import. À décider **avec** le prix de vente, pas avant | 05 puis perf |
| **Six articles sont en ligne sans code-barres** | 4 codes-barres sur les 21 479 du catalogue sont réutilisés par le fournisseur sur plusieurs articles, dont un `4053840000000` manifestement bouche-trou. WooCommerce refuse le doublon, et l'import préfère publier l'article sans code-barres plutôt que de perdre la référence entière | Rien de notre côté : c'est une donnée fournisseur. À savoir le jour où un flux marchand (Google Shopping) exigera un GTIN par article | 10 |

La rotation éventuelle de `ADMIN_TOKEN` est dans `ACCES-REQUIS.md` et n'est pas un écart :
c'est une action à faire.

---

## Quatre choses à savoir avant de toucher au code

1. **Le serveur calcule le prix.** Le studio affiche ce qu'on lui dit. Deux implémentations
   des mêmes règles finissent toujours par diverger, et le jour où elles divergent le client
   voit un chiffre et la facture en dit un autre.

2. **Fermé par défaut.** Un secret absent refuse tout. Un design non vérifiable refuse la
   ligne de panier. Une panne réseau n'est pas un feu vert.

3. **La couture entre du code correct et WooCommerce est là où l'argent se perd.** Le
   calcul de prix était juste ; un garde-fou recopié de tous les tutoriels sautait tous les
   recalculs sauf le premier, et un client qui passait de 9 à 50 pièces gardait l'ancien
   tarif. C'est pour cela qu'il existe une suite de tests contre un vrai panier WooCommerce
   en plus des tests purs.

4. **Une entrée de prix ne vient jamais du navigateur.** Pas seulement le prix : le
   vêtement vient de la fiche produit, les surfaces imprimées viennent du fichier de
   création déposé sur le serveur. Tout ce qu'une requête d'ajout au panier peut encore
   décider, c'est la quantité, que le client contrôle de toute façon depuis le panier.
