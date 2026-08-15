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

**Le catalogue fournisseur est dans la boutique.** 463 références et 26 399 articles, avec
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
provisionner`), 147 tests JavaScript, 104 tests PHP purs, 17 tests d'intégration WooCommerce,
une vérification de bout en bout du parcours d'achat à 40 assertions, un garde-fou qui
interdit à un prix d'achat, un nom de fournisseur ou un tarif film d'atteindre un gabarit
PHP, et des scripts de vérification qui font tourner le vrai code dans un vrai navigateur.

---

## Ce qu'il reste : quinze séances

Le détail exécutable de chacune vit dans `prompts/` (non versionné : ce sont des
instructions de travail, elles changent plus vite que le code).

| # | Séance | Bloquée par |
|---|---|---|
| ~~01~~ | ~~Boucler la boucle : du studio au panier WooCommerce~~ **faite** | - |
| ~~02~~ | ~~Fiche produit, grille de prix, demande de devis~~ **faite** | - |
| ~~03~~ | ~~Catalogue : Falk&Ross vers WooCommerce, à l'échelle~~ **faite** | - |
| 04 | Paiement : Stripe, TVA, livraison, facture | 02, 03 |
| 05 | Moteur de coût, prix plancher, commissions | - |
| 06 | BAT, cycle de vie de la commande, e-mails | 04 |
| 07 | Production : imbrication du film entre commandes | 06 |
| 08 | Commande fournisseur et stock | 03, 07 |
| 09 | Le site : accueil, navigation, système de design | 02 |
| 10 | Le studio en vitrine : 3D et mockups | 09 |
| 11 | Référencement, contenu, données structurées | 09 |
| 12 | Juridique, RGPD, accessibilité | 09 |
| 13 | Performance, sécurité, supervision | 09, 10 |
| 14 | Déploiement : préproduction, pipeline, purge de la démo | rien (accès obtenus le 14/08) |
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
| **Le régime de TVA** | associé | Question 17 et constat 6. La boutique a encaissé 15 commandes (465,79 EUR, nov. 2024 à avr. 2025) **taxes désactivées**. Franchise en base ou régularisation : la séance 04 construit 20 % partout et se trompe entièrement si la réponse est « franchise » |
| La vraie grille tarifaire | associé | Question 04 de `QUESTIONS-ASSOCIE.md` ; les prix actuels sont des **valeurs de démonstration** |
| **Le taux de marge sur un textile nu** | associé | Question 42. Les 26 399 articles du catalogue sont importés avec leur coût réel et **sans prix de vente** : consultables, non commandables, tant que le taux n'est pas fixé |
| Clés Stripe (test puis production) | associé | Séance 04 |
| Compte Brevo | associé | Séance 06 |
| `FR_CUSTOMER_NR` | associé | Séance 08. Absent des secrets, donc aucune commande fournisseur n'a jamais pu partir |

`QUESTIONS-ASSOCIE.md` contient 40 questions auxquelles seul l'associé peut répondre. Q04
(la grille tarifaire) conditionne une grande partie de la séance 05. Trois viennent d'être
ajoutées par la séance 02 : la durée de validité d'un devis (la Bible impose la mention et
ne donne aucune durée, et c'est un engagement ferme en droit français), le fait que la
commission d'un commercial figure ou non sur le document que le client reçoit, et la durée
de conservation d'une demande de devis sans suite.

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
